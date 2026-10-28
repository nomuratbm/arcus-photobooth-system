import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import jpeg from "jpeg-js";
import { executeE2E } from "./e2e-runner.mjs";

const GENUINE_JPEG = jpeg.encode(
  { data: Buffer.from([128, 128, 128, 255]), width: 1, height: 1 },
  50
).data;

describe("e2e-runner offline behavior", () => {
  let server;
  let wss;
  let port;
  let lastClientWs;
  let testScenario = "normal";
  let activePhotoId = null;

  before(async () => {
    server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/presign") {
        if (testScenario === "stalled_presign") {
          return;
        }

        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          activePhotoId = parsed.photoId;

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            uploadUrl: `http://127.0.0.1:${port}/upload`,
            key: `raw/${activePhotoId}.jpg`,
            expiresIn: 180,
            headers: { "Content-Type": "image/jpeg" },
          }));
        });
      } else if (req.method === "PUT" && req.url === "/upload") {
        if (testScenario === "stalled_upload") {
          return;
        }
        if (testScenario === "failed_put") {
          res.writeHead(500);
          res.end("S3 Upload Failed");
          return;
        }

        res.writeHead(200);
        res.end();

        if (testScenario === "error_notification") {
          setTimeout(() => {
            if (lastClientWs && lastClientWs.readyState === 1) {
              lastClientWs.send(JSON.stringify({ status: "error", message: "Bedrock processing timeout" }));
            }
          }, 10);
        } else if (testScenario === "mismatched_key") {
          setTimeout(() => {
            if (lastClientWs && lastClientWs.readyState === 1) {
              lastClientWs.send(JSON.stringify({ status: "done", key: "final/00000000-0000-4000-8000-000000000000.jpg" }));
            }
          }, 10);
        } else if (testScenario === "malformed_json_null") {
          setTimeout(() => {
            if (lastClientWs && lastClientWs.readyState === 1) {
              lastClientWs.send("null");
              setTimeout(() => {
                if (lastClientWs && lastClientWs.readyState === 1) {
                  lastClientWs.send(JSON.stringify({ status: "done", key: `final/${activePhotoId}.jpg` }));
                }
              }, 10);
            }
          }, 10);
        } else if (testScenario === "malformed_shapes") {
          setTimeout(() => {
            if (lastClientWs && lastClientWs.readyState === 1) {
              lastClientWs.send("[1, 2]");
              lastClientWs.send('"a-string"');
              lastClientWs.send("12345");
              lastClientWs.send("true");
              lastClientWs.send(JSON.stringify({ status: 999 }));
              lastClientWs.send(JSON.stringify({ status: "pending" }));
              setTimeout(() => {
                if (lastClientWs && lastClientWs.readyState === 1) {
                  lastClientWs.send(JSON.stringify({ status: "done", key: `final/${activePhotoId}.jpg` }));
                }
              }, 15);
            }
          }, 10);
        } else if (
          testScenario === "normal" ||
          testScenario === "cleanup_check" ||
          testScenario === "failed_image_fetch" ||
          testScenario === "failed_image_type" ||
          testScenario === "stalled_final_response" ||
          testScenario === "stalled_final_body" ||
          testScenario === "corrupted_final_image"
        ) {
          setTimeout(() => {
            if (lastClientWs && lastClientWs.readyState === 1) {
              lastClientWs.send(JSON.stringify({ status: "done", key: `final/${activePhotoId}.jpg` }));
            }
          }, 10);
        }
      } else if (req.method === "GET" && req.url && req.url.startsWith("/final/")) {
        if (testScenario === "stalled_final_response") {
          return;
        }
        if (testScenario === "stalled_final_body") {
          res.writeHead(200, { "Content-Type": "image/jpeg" });
          res.write(GENUINE_JPEG.subarray(0, 50));
          return;
        }
        if (testScenario === "failed_image_fetch") {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        if (testScenario === "failed_image_type") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html>Not a jpeg</html>");
          return;
        }
        if (testScenario === "corrupted_final_image") {
          const corrupted = Buffer.from(GENUINE_JPEG);
          corrupted[0] = 0x00;
          res.writeHead(200, { "Content-Type": "image/jpeg" });
          res.end(corrupted);
          return;
        }
        res.writeHead(200, { "Content-Type": "image/jpeg" });
        res.end(GENUINE_JPEG);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => {
      lastClientWs = ws;
      if (testScenario === "early_close") {
        setTimeout(() => {
          ws.close();
        }, 10);
      } else if (testScenario === "fast_completion") {
        setTimeout(() => {
          if (activePhotoId && ws.readyState === 1) {
            ws.send(JSON.stringify({ status: "done", key: `final/${activePhotoId}.jpg` }));
          }
        }, 5);
      }
    });

    await new Promise((res) => {
      server.listen(0, "127.0.0.1", () => {
        port = server.address().port;
        res();
      });
    });
  });

  after(async () => {
    wss.close();
    await new Promise((res) => server.close(res));
  });

  beforeEach(() => {
    testScenario = "normal";
    activePhotoId = null;
  });

  it("success: full e2e cycle completes and verifies genuine JPEG", async () => {
    testScenario = "normal";
    const result = await executeE2E({
      wsUrl: `ws://127.0.0.1:${port}`,
      presignUrl: `http://127.0.0.1:${port}/presign`,
      cfDomain: `http://127.0.0.1:${port}`,
      imageBytes: GENUINE_JPEG,
      timeoutMs: 3000,
      log: () => {},
      errLog: () => {},
    });
    assert.equal(result.success, true);
    assert.ok(result.timings.end > result.timings.start);
  });

  it("rejects invalid timeout configuration", async () => {
    for (const bad of [0, -100, 1.5, "fast", NaN, Infinity]) {
      await assert.rejects(
        () =>
          executeE2E({
            wsUrl: `ws://127.0.0.1:${port}`,
            presignUrl: `http://127.0.0.1:${port}/presign`,
            cfDomain: `http://127.0.0.1:${port}`,
            imageBytes: GENUINE_JPEG,
            timeoutMs: bad,
            log: () => {},
            errLog: () => {},
          }),
        /timeoutMs must be a finite positive integer/
      );
    }
  });

  it("stalled presign response: enforces overall deadline", async () => {
    testScenario = "stalled_presign";
    const start = Date.now();
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: GENUINE_JPEG,
          timeoutMs: 120,
          log: () => {},
          errLog: () => {},
        }),
      /Overall timeout after 120ms/
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 100 && elapsed < 400);
  });

  it("stalled upload response: enforces overall deadline", async () => {
    testScenario = "stalled_upload";
    const start = Date.now();
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: GENUINE_JPEG,
          timeoutMs: 120,
          log: () => {},
          errLog: () => {},
        }),
      /Overall timeout after 120ms/
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 100 && elapsed < 400);
  });

  it("stalled final image response: enforces overall deadline", async () => {
    testScenario = "stalled_final_response";
    const start = Date.now();
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: GENUINE_JPEG,
          timeoutMs: 120,
          log: () => {},
          errLog: () => {},
        }),
      /Overall timeout after 120ms/
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 100 && elapsed < 400);
  });

  it("stalled final image body: enforces overall deadline", async () => {
    testScenario = "stalled_final_body";
    const start = Date.now();
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: GENUINE_JPEG,
          timeoutMs: 120,
          log: () => {},
          errLog: () => {},
        }),
      /Overall timeout after 120ms/
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 100 && elapsed < 400);
  });

  it("malformed message: JSON null does not crash and valid message completes run", async () => {
    testScenario = "malformed_json_null";
    const result = await executeE2E({
      wsUrl: `ws://127.0.0.1:${port}`,
      presignUrl: `http://127.0.0.1:${port}/presign`,
      cfDomain: `http://127.0.0.1:${port}`,
      imageBytes: GENUINE_JPEG,
      timeoutMs: 2000,
      log: () => {},
      errLog: () => {},
    });
    assert.equal(result.success, true);
  });

  it("malformed message: non-object shapes do not crash and valid message completes run", async () => {
    testScenario = "malformed_shapes";
    const result = await executeE2E({
      wsUrl: `ws://127.0.0.1:${port}`,
      presignUrl: `http://127.0.0.1:${port}/presign`,
      cfDomain: `http://127.0.0.1:${port}`,
      imageBytes: GENUINE_JPEG,
      timeoutMs: 2000,
      log: () => {},
      errLog: () => {},
    });
    assert.equal(result.success, true);
  });

  it("error notification: rejects on processing error message", async () => {
    testScenario = "error_notification";
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: GENUINE_JPEG,
          timeoutMs: 2000,
          log: () => {},
          errLog: () => {},
        }),
      /Processing error: Bedrock processing timeout/
    );
  });

  it("mismatched key: rejects when notification key does not match photoId", async () => {
    testScenario = "mismatched_key";
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: GENUINE_JPEG,
          timeoutMs: 2000,
          log: () => {},
          errLog: () => {},
        }),
      /Result key does not match photoId/
    );
  });

  it("early close: rejects if socket closes unexpectedly", async () => {
    testScenario = "early_close";
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: GENUINE_JPEG,
          timeoutMs: 2000,
          log: () => {},
          errLog: () => {},
        }),
      /WebSocket closed unexpectedly/
    );
  });

  it("failed PUT: rejects on S3 upload error", async () => {
    testScenario = "failed_put";
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: GENUINE_JPEG,
          timeoutMs: 2000,
          log: () => {},
          errLog: () => {},
        }),
      /Upload failed: 500/
    );
  });

  it("failed image response: rejects on 404 for final image", async () => {
    testScenario = "failed_image_fetch";
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: GENUINE_JPEG,
          timeoutMs: 2000,
          log: () => {},
          errLog: () => {},
        }),
      /Final image fetch failed: 404/
    );
  });

  it("failed image type: rejects when final image is not image/jpeg", async () => {
    testScenario = "failed_image_type";
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: GENUINE_JPEG,
          timeoutMs: 2000,
          log: () => {},
          errLog: () => {},
        }),
      /Unexpected content-type/
    );
  });

  it("input image validation: rejects truncated input JPEG", async () => {
    const truncated = GENUINE_JPEG.subarray(0, 30);
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: truncated,
          timeoutMs: 2000,
          log: () => {},
          errLog: () => {},
        }),
      /TEST_IMAGE_PATH cannot be decoded as a valid JPEG/
    );
  });

  it("input image validation: rejects corrupted input JPEG", async () => {
    const corrupted = Buffer.from(GENUINE_JPEG);
    corrupted[0] = 0x00;
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: corrupted,
          timeoutMs: 2000,
          log: () => {},
          errLog: () => {},
        }),
      /TEST_IMAGE_PATH does not appear to be a JPEG file/
    );
  });

  it("final image validation: rejects corrupted final JPEG output", async () => {
    testScenario = "corrupted_final_image";
    await assert.rejects(
      () =>
        executeE2E({
          wsUrl: `ws://127.0.0.1:${port}`,
          presignUrl: `http://127.0.0.1:${port}/presign`,
          cfDomain: `http://127.0.0.1:${port}`,
          imageBytes: GENUINE_JPEG,
          timeoutMs: 2000,
          log: () => {},
          errLog: () => {},
        }),
      /Final image does not have JPEG signature/
    );
  });

  it("cleanup: closes WebSocket client on completion", async () => {
    testScenario = "cleanup_check";
    await executeE2E({
      wsUrl: `ws://127.0.0.1:${port}`,
      presignUrl: `http://127.0.0.1:${port}/presign`,
      cfDomain: `http://127.0.0.1:${port}`,
      imageBytes: GENUINE_JPEG,
      timeoutMs: 2000,
      log: () => {},
      errLog: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(lastClientWs.readyState, 3);
  });

  it("fast completion: handles result arriving during or right after upload", async () => {
    testScenario = "fast_completion";
    const result = await executeE2E({
      wsUrl: `ws://127.0.0.1:${port}`,
      presignUrl: `http://127.0.0.1:${port}/presign`,
      cfDomain: `http://127.0.0.1:${port}`,
      imageBytes: GENUINE_JPEG,
      timeoutMs: 2000,
      log: () => {},
      errLog: () => {},
    });
    assert.equal(result.success, true);
  });
});
