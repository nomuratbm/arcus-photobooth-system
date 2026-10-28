import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { S3Client } from "@aws-sdk/client-s3";
import { handler } from "../index.mjs";

function makeEvent(method, body, overrides = {}) {
  const event = {
    httpMethod: method,
    headers: {
      "content-type": "application/json",
      ...(overrides.headers || {}),
    },
    body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : null,
    isBase64Encoded: false,
    requestContext: overrides.requestContext || {},
    ...overrides,
  };
  if (overrides.headers) {
    event.headers = { ...event.headers, ...overrides.headers };
  }
  return event;
}

function makeV2Event(method, body, overrides = {}) {
  return makeEvent(method, body, {
    ...overrides,
    requestContext: {
      http: { method },
      ...(overrides.requestContext || {}),
    },
  });
}

const VALID_ID = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
const FAKE_URL = "https://s3.amazonaws.com/test-bucket/raw/test.jpg?signed";

function makeSigner() {
  return async () => FAKE_URL;
}

describe("presign", () => {
  beforeEach(() => {
    process.env.BUCKET_NAME = "test-bucket";
    delete process.env.ALLOWED_ORIGIN;
  });

  it("returns signed URL for valid POST request", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID }),
      {},
      { signer: makeSigner() }
    );

    assert.equal(result.statusCode, 200);
    const body = JSON.parse(result.body);
    assert.equal(body.uploadUrl, FAKE_URL);
    assert.equal(body.key, `raw/${VALID_ID}.jpg`);
    assert.equal(body.expiresIn, 180);
    assert.deepStrictEqual(body.headers, { "Content-Type": "image/jpeg" });
  });

  it("generates valid signed URL using real S3 client without empty-body checksum and with signed Content-Type", async () => {
    const s3 = new S3Client({
      region: "us-east-1",
      credentials: { accessKeyId: "mockKeyId", secretAccessKey: "mockSecretKey" },
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID }),
      {},
      { s3 }
    );

    assert.equal(result.statusCode, 200);
    const body = JSON.parse(result.body);
    const parsedUrl = new URL(body.uploadUrl);

    assert.equal(parsedUrl.hostname, "test-bucket.s3.us-east-1.amazonaws.com");
    assert.equal(parsedUrl.pathname, `/raw/${VALID_ID}.jpg`);
    assert.equal(parsedUrl.searchParams.get("X-Amz-Expires"), "180");

    const signedHeaders = parsedUrl.searchParams.get("X-Amz-SignedHeaders") || "";
    assert.ok(signedHeaders.includes("content-type"));
    assert.ok(signedHeaders.includes("host"));

    assert.equal(parsedUrl.searchParams.get("x-amz-checksum-crc32"), null);
    assert.equal(parsedUrl.searchParams.get("x-amz-sdk-checksum-algorithm"), null);
  });

  it("derives key server-side as raw/{photoId}.jpg", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID }),
      {},
      { signer: makeSigner() }
    );
    const body = JSON.parse(result.body);
    assert.equal(body.key, `raw/${VALID_ID}.jpg`);
  });

  it("supports HTTP API v2 payload format", async () => {
    const result = await handler(
      makeV2Event("POST", { photoId: VALID_ID }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 200);
  });

  it("rejects non-POST methods with 405", async () => {
    for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
      const result = await handler(
        makeEvent(method, {}),
        {},
        { signer: makeSigner() }
      );
      assert.equal(result.statusCode, 405);
      assert.equal(result.headers.Allow, "POST, OPTIONS");
    }
  });

  it("responds to OPTIONS with 204", async () => {
    const result = await handler(
      makeEvent("OPTIONS", null),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 204);
  });

  it("accepts application/json with charset parameter", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID }, {
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 200);
  });

  it("rejects application/jsonp with 415", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID }, {
        headers: { "content-type": "application/jsonp" },
      }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 415);
  });

  it("rejects non-JSON content type with 415", async () => {
    const result = await handler(
      makeEvent("POST", {}, {
        headers: { "content-type": "text/plain" },
      }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 415);
  });

  it("rejects invalid JSON body with 400", async () => {
    const result = await handler(
      makeEvent("POST", "not valid json"),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("rejects missing body with 400", async () => {
    const result = await handler(
      makeEvent("POST", undefined),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("rejects invalid photoId with 400", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: "bad-id" }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("rejects non-v4 photoId with 400", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("rejects missing photoId with 400", async () => {
    const result = await handler(
      makeEvent("POST", {}),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("rejects unknown fields with 400", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID, evil: "data" }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("rejects photoId with path traversal", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: "../../../etc/passwd" }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("rejects photoId with encoded path traversal", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: "..%2F..%2Fetc" }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("rejects oversized body with 413", async () => {
    const bigString = "x".repeat(5000);
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID, padding: bigString }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 413);
  });

  it("handles valid base64-encoded body", async () => {
    const encoded = Buffer.from(JSON.stringify({ photoId: VALID_ID })).toString("base64");
    const result = await handler(
      {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: encoded,
        isBase64Encoded: true,
      },
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 200);
  });

  it("rejects base64 body with invalid characters", async () => {
    const result = await handler(
      {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: "eyJwaG90b0lkIjoi...bad!@#",
        isBase64Encoded: true,
      },
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("rejects base64 body with invalid padding", async () => {
    const result = await handler(
      {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: "YWJj===",
        isBase64Encoded: true,
      },
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("rejects base64 body with invalid decoded JSON", async () => {
    const encoded = Buffer.from("not json at all").toString("base64");
    const result = await handler(
      {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: encoded,
        isBase64Encoded: true,
      },
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("rejects oversized decoded base64 body with 413", async () => {
    const largeObj = { photoId: VALID_ID, pad: "y".repeat(4500) };
    const encoded = Buffer.from(JSON.stringify(largeObj)).toString("base64");
    const result = await handler(
      {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: encoded,
        isBase64Encoded: true,
      },
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 413);
  });

  it("returns 500 when BUCKET_NAME is missing", async () => {
    delete process.env.BUCKET_NAME;
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 500);
  });

  it("returns 500 when signer fails", async () => {
    const failingSigner = async () => {
      throw new Error("signing failed");
    };
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID }),
      {},
      { signer: failingSigner }
    );
    assert.equal(result.statusCode, 500);
  });

  it("sets Cache-Control: no-store on all responses", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.headers["Cache-Control"], "no-store");
  });

  it("accepts optional expiresIn within bounds", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID, expiresIn: 120 }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 200);
    const body = JSON.parse(result.body);
    assert.equal(body.expiresIn, 120);
  });

  it("rejects expiresIn below minimum", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID, expiresIn: 10 }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("rejects expiresIn above maximum", async () => {
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID, expiresIn: 999 }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });

  it("returns CORS headers when origin matches ALLOWED_ORIGIN", async () => {
    process.env.ALLOWED_ORIGIN = "https://kiosk.example.com";
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID }, {
        headers: {
          origin: "https://kiosk.example.com",
        },
      }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.headers["Access-Control-Allow-Origin"], "https://kiosk.example.com");
    assert.equal(result.headers.Vary, "Origin");
  });

  it("does not return CORS headers for non-matching origin", async () => {
    process.env.ALLOWED_ORIGIN = "https://kiosk.example.com";
    const result = await handler(
      makeEvent("POST", { photoId: VALID_ID }, {
        headers: {
          origin: "https://evil.example.com",
        },
      }),
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.headers["Access-Control-Allow-Origin"], undefined);
  });

  it("rejects array body with 400", async () => {
    const result = await handler(
      {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ photoId: VALID_ID }]),
      },
      {},
      { signer: makeSigner() }
    );
    assert.equal(result.statusCode, 400);
  });
});
