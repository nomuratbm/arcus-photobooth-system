import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import process from "node:process";
import jpeg from "jpeg-js";

export async function executeE2E({
  wsUrl,
  presignUrl,
  cfDomain,
  imagePath,
  imageBytes,
  timeoutMs = 60000,
  log = console.log,
  errLog = console.error,
} = {}) {
  if (!wsUrl || !presignUrl || !cfDomain || (!imagePath && !imageBytes)) {
    throw new Error("Missing required parameters for executeE2E");
  }

  const timeoutNum = Number(timeoutMs);
  if (!Number.isInteger(timeoutNum) || timeoutNum <= 0) {
    throw new Error("timeoutMs must be a finite positive integer");
  }

  const bytes = imageBytes || readFileSync(imagePath);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error("TEST_IMAGE_PATH does not appear to be a JPEG file");
  }

  let decodedInput;
  try {
    decodedInput = jpeg.decode(bytes);
  } catch (err) {
    throw new Error("TEST_IMAGE_PATH cannot be decoded as a valid JPEG: " + err.message);
  }
  if (!decodedInput || decodedInput.width <= 0 || decodedInput.height <= 0) {
    throw new Error("TEST_IMAGE_PATH does not have valid dimensions");
  }

  log("Loaded test image: " + bytes.length + " bytes (" + decodedInput.width + "x" + decodedInput.height + ")");

  const photoId = randomUUID();
  log("Generated photoId: " + photoId);

  const timings = { start: Date.now() };
  let ws;
  let timeoutTimer;
  let isCleaningUp = false;

  const abortController = new AbortController();
  const { signal } = abortController;

  try {
    const timeoutPromise = new Promise((_, rej) => {
      timeoutTimer = setTimeout(() => {
        const err = new Error("Overall timeout after " + timeoutNum + "ms");
        abortController.abort(err);
        rej(err);
      }, timeoutNum);
    });
    timeoutPromise.catch(() => {});

    let wsOpenResolve, wsOpenReject;
    const wsOpenPromise = new Promise((res, rej) => {
      wsOpenResolve = res;
      wsOpenReject = rej;
    });
    wsOpenPromise.catch(() => {});

    let wsResultResolve, wsResultReject;
    const wsResultPromise = new Promise((res, rej) => {
      wsResultResolve = res;
      wsResultReject = rej;
    });
    wsResultPromise.catch(() => {});

    signal.addEventListener("abort", () => {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          ws.terminate();
        } catch {}
      }
    });

    const connectUrl = wsUrl + (wsUrl.includes("?") ? "&" : "?") + "photoId=" + photoId;
    ws = new WebSocket(connectUrl);

    ws.on("open", () => {
      timings.connected = Date.now();
      log("WebSocket connected (" + (timings.connected - timings.start) + "ms)");
      wsOpenResolve();
    });

    ws.on("error", (err) => {
      if (isCleaningUp) return;
      const e = new Error("WebSocket error: " + err.message);
      wsOpenReject(e);
      wsResultReject(e);
    });

    ws.on("close", (code) => {
      if (isCleaningUp) return;
      const e = new Error("WebSocket closed unexpectedly: code " + code);
      wsOpenReject(e);
      wsResultReject(e);
    });

    ws.on("message", (data) => {
      if (isCleaningUp) return;
      const raw = data.toString();
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        errLog("Received non-JSON message, ignoring");
        return;
      }

      if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
        errLog("Received non-object JSON message, ignoring");
        return;
      }

      if (typeof msg.status !== "string") {
        errLog("Received message without string status, ignoring");
        return;
      }

      timings.resultReceived = Date.now();

      if (msg.status === "done") {
        if (typeof msg.key !== "string" || msg.key !== "final/" + photoId + ".jpg") {
          wsResultReject(new Error("Result key does not match photoId: " + String(msg.key)));
          return;
        }
        wsResultResolve({ status: "done", key: msg.key });
      } else if (msg.status === "error") {
        const errMsg = typeof msg.message === "string" ? msg.message : "unknown";
        wsResultReject(new Error("Processing error: " + errMsg));
      } else {
        errLog("Received message with unhandled status: " + msg.status + ", ignoring");
      }
    });

    await Promise.race([wsOpenPromise, timeoutPromise]);

    const presignRes = await fetch(presignUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId }),
      signal,
    });

    if (!presignRes.ok) {
      const body = await presignRes.text();
      throw new Error("Presign failed: " + presignRes.status + " " + body);
    }

    const presignData = await presignRes.json();
    timings.presigned = Date.now();
    log("Presigned URL received (" + (timings.presigned - timings.connected) + "ms)");

    if (presignData.key !== "raw/" + photoId + ".jpg") {
      throw new Error("Unexpected presign key: " + presignData.key);
    }

    const uploadHeaders = {};
    if (presignData.headers) {
      for (const [k, v] of Object.entries(presignData.headers)) {
        uploadHeaders[k] = v;
      }
    }

    const uploadRes = await fetch(presignData.uploadUrl, {
      method: "PUT",
      headers: uploadHeaders,
      body: bytes,
      signal,
    });

    if (!uploadRes.ok) {
      throw new Error("Upload failed: " + uploadRes.status);
    }

    timings.uploaded = Date.now();
    log("Image uploaded (" + (timings.uploaded - timings.presigned) + "ms)");

    const result = await Promise.race([wsResultPromise, timeoutPromise]);

    timings.processingComplete = Date.now();
    const processingDuration = (timings.resultReceived || Date.now()) - timings.uploaded;
    log("Processing result received: " + result.status);
    log("Processing duration (upload to result): " + processingDuration + "ms");

    const finalUrl = cfDomain.startsWith("http://") || cfDomain.startsWith("https://")
      ? cfDomain + "/" + result.key
      : "https://" + cfDomain + "/" + result.key;

    const imgRes = await fetch(finalUrl, { signal });

    if (imgRes.status !== 200) {
      throw new Error("Final image fetch failed: " + imgRes.status);
    }

    const contentType = imgRes.headers.get("content-type") || "";
    const [mediaType] = contentType.split(";").map((s) => s.trim().toLowerCase());
    if (mediaType !== "image/jpeg") {
      throw new Error("Unexpected content-type: " + contentType);
    }

    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    if (imgBuf.length === 0) {
      throw new Error("Final image is empty");
    }

    if (imgBuf.length < 4 || imgBuf[0] !== 0xff || imgBuf[1] !== 0xd8 || imgBuf[2] !== 0xff) {
      throw new Error("Final image does not have JPEG signature");
    }

    let decodedFinal;
    try {
      decodedFinal = jpeg.decode(imgBuf);
    } catch (err) {
      throw new Error("Final image cannot be decoded as a valid JPEG: " + err.message);
    }
    if (!decodedFinal || decodedFinal.width <= 0 || decodedFinal.height <= 0) {
      throw new Error("Final image does not have valid dimensions");
    }

    timings.end = Date.now();

    if (timings.end - timings.start >= timeoutNum || signal.aborted) {
      throw new Error("Overall timeout after " + timeoutNum + "ms");
    }

    log("Final image verified: " + imgBuf.length + " bytes (" + decodedFinal.width + "x" + decodedFinal.height + "), valid JPEG");
    log("");
    log("--- Timing Summary ---");
    log("Total wall time:     " + (timings.end - timings.start) + "ms");
    log("WS connect:          " + (timings.connected - timings.start) + "ms");
    log("Presign:             " + (timings.presigned - timings.connected) + "ms");
    log("Upload:              " + (timings.uploaded - timings.presigned) + "ms");
    log("Processing:          " + processingDuration + "ms");
    log("Image fetch+verify:  " + (timings.end - timings.processingComplete) + "ms");
    log("");
    log("E2E test PASSED");

    return { success: true, photoId, timings };
  } catch (err) {
    if (signal.aborted) {
      throw new Error("Overall timeout after " + timeoutNum + "ms");
    }
    throw err;
  } finally {
    isCleaningUp = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      try {
        ws.terminate();
      } catch {}
    }
  }
}

async function run() {
  const wsUrl = process.env.WS_URL;
  const presignUrl = process.env.PRESIGN_URL;
  const cfDomain = process.env.CLOUDFRONT_DOMAIN;
  const imagePath = process.env.TEST_IMAGE_PATH;
  const rawTimeout = process.env.TEST_TIMEOUT_MS;

  const missing = [];
  if (!wsUrl) missing.push("WS_URL");
  if (!presignUrl) missing.push("PRESIGN_URL");
  if (!cfDomain) missing.push("CLOUDFRONT_DOMAIN");
  if (!imagePath) missing.push("TEST_IMAGE_PATH");

  if (missing.length > 0) {
    console.error("Missing required environment variables: " + missing.join(", "));
    console.error("");
    console.error("Required configuration:");
    console.error("  WS_URL            - WebSocket API endpoint (wss://...)");
    console.error("  PRESIGN_URL       - Presign Lambda HTTP endpoint");
    console.error("  CLOUDFRONT_DOMAIN - CloudFront distribution domain");
    console.error("  TEST_IMAGE_PATH   - Path to a local JPEG file for upload");
    console.error("");
    console.error("Optional:");
    console.error("  TEST_TIMEOUT_MS   - Overall timeout (default: 60000)");
    process.exit(1);
  }

  const timeoutMs = rawTimeout ? Number(rawTimeout) : 60000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    console.error("TEST_TIMEOUT_MS must be a positive integer");
    process.exit(1);
  }

  try {
    await executeE2E({
      wsUrl,
      presignUrl,
      cfDomain,
      imagePath,
      timeoutMs,
    });
  } catch (err) {
    console.error("E2E test FAILED: " + err.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run();
}
