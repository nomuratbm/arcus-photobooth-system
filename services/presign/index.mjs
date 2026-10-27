import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { validatePhotoId } from "./validate-photo-id.mjs";

let s3Client;

function getS3Client(inject) {
  if (inject) return inject;
  if (!s3Client) {
    s3Client = new S3Client({
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  }
  return s3Client;
}

const MAX_BODY_BYTES = 4096;
const DEFAULT_EXPIRES_IN = 180;
const MIN_EXPIRES_IN = 60;
const MAX_EXPIRES_IN = 300;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function getCorsHeaders(origin) {
  const allowed = process.env.ALLOWED_ORIGIN;
  if (!allowed) return {};
  if (origin === allowed) {
    return {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "3600",
      "Vary": "Origin",
    };
  }
  return {};
}

function response(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

function getMethod(event) {
  if (event && event.requestContext && event.requestContext.http && event.requestContext.http.method) {
    return event.requestContext.http.method;
  }
  return (event && event.httpMethod) || null;
}

function getOrigin(event) {
  if (!event || !event.headers) return null;
  const key = Object.keys(event.headers).find((k) => k.toLowerCase() === "origin");
  return key ? event.headers[key] : null;
}

function getContentType(event) {
  if (!event || !event.headers) return null;
  const key = Object.keys(event.headers).find((k) => k.toLowerCase() === "content-type");
  return key ? event.headers[key] : null;
}

function isJsonContentType(contentType) {
  if (typeof contentType !== "string") return false;
  const parts = contentType.split(";").map((p) => p.trim().toLowerCase());
  return parts[0] === "application/json";
}

function parseBody(event) {
  let raw = event && event.body;
  if (!raw || typeof raw !== "string") return null;

  if (event.isBase64Encoded) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length % 4 !== 0 || !BASE64_RE.test(trimmed)) {
      return null;
    }
    const padding = trimmed.endsWith("==") ? 2 : (trimmed.endsWith("=") ? 1 : 0);
    const approxBytes = (trimmed.length * 3) / 4 - padding;
    if (approxBytes > MAX_BODY_BYTES) {
      return { __oversized: true };
    }
    try {
      raw = Buffer.from(trimmed, "base64").toString("utf-8");
    } catch {
      return null;
    }
  }

  if (Buffer.byteLength(raw, "utf-8") > MAX_BODY_BYTES) {
    return { __oversized: true };
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function handler(event, context, { s3, signer } = {}) {
  const bucketName = process.env.BUCKET_NAME;
  if (!bucketName) {
    return response(500, { error: "Server configuration error" });
  }

  const origin = getOrigin(event);
  const cors = getCorsHeaders(origin);
  const method = getMethod(event);

  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: { ...cors },
      body: "",
    };
  }

  if (method !== "POST") {
    return response(405, { error: "Method not allowed" }, {
      Allow: "POST, OPTIONS",
      ...cors,
    });
  }

  const contentType = getContentType(event);
  if (!contentType || !isJsonContentType(contentType)) {
    return response(415, { error: "Unsupported media type" }, cors);
  }

  const body = parseBody(event);
  if (!body) {
    return response(400, { error: "Invalid request body" }, cors);
  }
  if (body.__oversized) {
    return response(413, { error: "Request body too large" }, cors);
  }

  const allowedFields = new Set(["photoId", "expiresIn"]);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      return response(400, { error: "Unknown field: " + key }, cors);
    }
  }

  const photoId = validatePhotoId(body.photoId);
  if (!photoId) {
    return response(400, { error: "Invalid photoId" }, cors);
  }

  let expiresIn = DEFAULT_EXPIRES_IN;
  if (body.expiresIn !== undefined) {
    const exp = Number(body.expiresIn);
    if (!Number.isInteger(exp) || exp < MIN_EXPIRES_IN || exp > MAX_EXPIRES_IN) {
      return response(400, { error: "expiresIn must be an integer between 60 and 300" }, cors);
    }
    expiresIn = exp;
  }

  const key = `raw/${photoId}.jpg`;

  const client = getS3Client(s3);
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: "image/jpeg",
  });

  let uploadUrl;
  try {
    const sign = signer || getSignedUrl;
    uploadUrl = await sign(client, command, {
      expiresIn,
      signableHeaders: new Set(["content-type", "host"]),
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "signing_failed", error: err.name }));
    return response(500, { error: "Failed to generate upload URL" }, cors);
  }

  return response(200, {
    uploadUrl,
    key,
    expiresIn,
    headers: {
      "Content-Type": "image/jpeg",
    },
  }, cors);
}
