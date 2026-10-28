import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const EVENT_ID = "sample-event-001";
const WIDTH = 1200;
const HEIGHT = 1600;

function readPngDimensions(buf) {
  if (buf[0] !== 137 || buf[1] !== 80 || buf[2] !== 78 || buf[3] !== 71) {
    return null;
  }
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  return { w, h, bitDepth, colorType };
}

describe("sample event assets", () => {
  const bgPath = join(REPO_ROOT, "assets", "backgrounds", EVENT_ID, "background.png");
  const frPath = join(REPO_ROOT, "assets", "frames", EVENT_ID, "frame.png");

  it("background.png exists and is a valid PNG", () => {
    assert.ok(existsSync(bgPath), "background.png must exist");
    const buf = readFileSync(bgPath);
    const info = readPngDimensions(buf);
    assert.ok(info, "must be a valid PNG");
  });

  it("frame.png exists and is a valid PNG", () => {
    assert.ok(existsSync(frPath), "frame.png must exist");
    const buf = readFileSync(frPath);
    const info = readPngDimensions(buf);
    assert.ok(info, "must be a valid PNG");
  });

  it("background has correct dimensions", () => {
    const buf = readFileSync(bgPath);
    const info = readPngDimensions(buf);
    assert.equal(info.w, WIDTH);
    assert.equal(info.h, HEIGHT);
  });

  it("frame has correct dimensions matching background", () => {
    const buf = readFileSync(frPath);
    const info = readPngDimensions(buf);
    assert.equal(info.w, WIDTH);
    assert.equal(info.h, HEIGHT);
  });

  it("frame uses RGBA color type (has alpha channel)", () => {
    const buf = readFileSync(frPath);
    const info = readPngDimensions(buf);
    assert.equal(info.colorType, 6);
  });

  it("frame opening has genuinely transparent pixels", () => {
    const buf = readFileSync(frPath);
    let p = 8;
    const idats = [];
    while (p < buf.length) {
      const len = buf.readUInt32BE(p);
      const type = buf.toString("ascii", p + 4, p + 8);
      if (type === "IDAT") {
        idats.push(buf.subarray(p + 8, p + 8 + len));
      }
      p += 12 + len;
    }
    const decompressed = inflateSync(Buffer.concat(idats));
    const rowLen = 1 + WIDTH * 4;
    const centerAlpha = decompressed[800 * rowLen + 1 + 600 * 4 + 3];
    const borderAlpha = decompressed[20 * rowLen + 1 + 600 * 4 + 3];
    assert.equal(centerAlpha, 0);
    assert.equal(borderAlpha, 255);
  });

  it("background and frame have matching dimensions", () => {
    const bgInfo = readPngDimensions(readFileSync(bgPath));
    const frInfo = readPngDimensions(readFileSync(frPath));
    assert.equal(bgInfo.w, frInfo.w);
    assert.equal(bgInfo.h, frInfo.h);
  });

  it("asset files have safe filenames", () => {
    assert.ok(!EVENT_ID.includes("/"));
    assert.ok(!EVENT_ID.includes("\\"));
    assert.ok(!EVENT_ID.includes(".."));
    assert.ok(EVENT_ID.length > 0 && EVENT_ID.length < 100);
  });
});
