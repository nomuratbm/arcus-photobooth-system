import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const EVENT_ID = "sample-event-001";
const WIDTH = 1200;
const HEIGHT = 1600;

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcData = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function createPNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLen = width * 4;
  const raw = Buffer.alloc(height * (1 + rowLen));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + rowLen)] = 0;
    rgba.copy(raw, y * (1 + rowLen) + 1, y * rowLen, (y + 1) * rowLen);
  }

  const compressed = deflateSync(raw, { level: 6 });

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", iend),
  ]);
}

function makeBackground(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const offset = (y * w + x) * 4;
      const dx = (x / w) - 0.5;
      const dy = (y / h) - 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const t = Math.min(dist * 2, 1);
      buf[offset] = Math.round(15 + t * 10);
      buf[offset + 1] = Math.round(27 + t * 15);
      buf[offset + 2] = Math.round(45 + t * 20);
      buf[offset + 3] = 255;
    }
  }
  return buf;
}

function makeFrame(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  const border = 60;
  const bottomBar = 180;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const offset = (y * w + x) * 4;
      const inTopBorder = y < border;
      const inBottomBorder = y >= h - bottomBar;
      const inLeftBorder = x < border;
      const inRightBorder = x >= w - border;
      const isBorder = inTopBorder || inBottomBorder || inLeftBorder || inRightBorder;

      if (isBorder) {
        const inGoldLine =
          (y >= border - 4 && y < border && x >= border - 4 && x < w - border + 4) ||
          (y >= h - bottomBar && y < h - bottomBar + 4 && x >= border - 4 && x < w - border + 4) ||
          (x >= border - 4 && x < border && y >= border - 4 && y < h - bottomBar + 4) ||
          (x >= w - border && x < w - border + 4 && y >= border - 4 && y < h - bottomBar + 4);

        if (inGoldLine) {
          buf[offset] = 200;
          buf[offset + 1] = 169;
          buf[offset + 2] = 110;
          buf[offset + 3] = 255;
        } else {
          buf[offset] = 30;
          buf[offset + 1] = 58;
          buf[offset + 2] = 95;
          buf[offset + 3] = 255;
        }
      } else {
        buf[offset] = 0;
        buf[offset + 1] = 0;
        buf[offset + 2] = 0;
        buf[offset + 3] = 0;
      }
    }
  }
  return buf;
}

const bgDir = join(REPO_ROOT, "assets", "backgrounds", EVENT_ID);
const frDir = join(REPO_ROOT, "assets", "frames", EVENT_ID);
mkdirSync(bgDir, { recursive: true });
mkdirSync(frDir, { recursive: true });

const bgRGBA = makeBackground(WIDTH, HEIGHT);
const bgPng = createPNG(WIDTH, HEIGHT, bgRGBA);
writeFileSync(join(bgDir, "background.png"), bgPng);
console.log("background.png:", WIDTH + "x" + HEIGHT + ",", bgPng.length, "bytes");

const frRGBA = makeFrame(WIDTH, HEIGHT);
const frPng = createPNG(WIDTH, HEIGHT, frRGBA);
writeFileSync(join(frDir, "frame.png"), frPng);
console.log("frame.png:", WIDTH + "x" + HEIGHT + ",", frPng.length, "bytes");

let transparentPixels = 0;
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    if (frRGBA[(y * WIDTH + x) * 4 + 3] === 0) transparentPixels++;
  }
}
console.log("frame transparent pixels:", transparentPixels, "of", WIDTH * HEIGHT);
console.log("event ID:", EVENT_ID);
