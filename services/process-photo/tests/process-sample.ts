import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { removeBackgroundWithBedrock } from '../src/bedrock.js';
import { compositeStrip } from '../src/composite.js';
import { SHOT_COUNT } from '../src/frame-layout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetsRoot = path.join(__dirname, '..', '..', '..', 'assets');

async function processSamplePhoto() {
  console.log('====================================================');
  console.log('     Local Photobooth Pipeline with Sample Photo');
  console.log('====================================================\n');

  const defaultSamplePath = path.join(__dirname, 'samples', 'guest_sample.jpg');
  const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultSamplePath;

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input photo not found at: ${inputPath}`);
    process.exit(1);
  }

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 1. Read input photo
  console.log(`1. 📸 Reading raw photo from: ${inputPath}`);
  const rawBuffer = fs.readFileSync(inputPath);
  const rawMeta = await sharp(rawBuffer).metadata();
  console.log(`   Dimensions: ${rawMeta.width}x${rawMeta.height}, Format: ${rawMeta.format}`);

  // 2. Call Bedrock to remove background
  console.log('\n2. 🪄 Calling Amazon Bedrock to remove background (producing cutout)...');
  const t0 = Date.now();
  const cutoutBuffer = await removeBackgroundWithBedrock(rawBuffer);
  const bedrockDuration = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`   ✅ Bedrock finished in ${bedrockDuration}s! Cutout size: ${cutoutBuffer.length} bytes.`);

  const cutoutPath = path.join(outputDir, 'sample_cutout.png');
  fs.writeFileSync(cutoutPath, cutoutBuffer);
  console.log(`   Cutout saved to: ${cutoutPath}`);

  // 3. Load the baked frame overlay and curated backgrounds
  console.log('\n3. 🎨 Preparing frame overlay & curated backgrounds...');
  const overlayPath = path.join(assetsRoot, 'frames', 'curated', 'default.png');
  const overlayBuffer = fs.readFileSync(overlayPath);

  const bgDir = path.join(assetsRoot, 'backgrounds', 'curated');
  const bgFiles = fs
    .readdirSync(bgDir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .slice(0, SHOT_COUNT);
  const backgrounds = bgFiles.map((f) => fs.readFileSync(path.join(bgDir, f)));

  // Reuse the single sample cutout across all slots for the local demo.
  const slots = backgrounds.map((backgroundBuffer) => ({
    backgroundBuffer,
    cutoutBuffer,
  }));

  // 4. Composite: per-slot subtle background + cutout, frame overlay on top
  console.log('\n4. 🖼️  Compositing strip (slots → overlay)...');
  const t1 = Date.now();
  const finalJpeg = await compositeStrip(overlayBuffer, slots, { quality: 92 });
  const compDuration = Date.now() - t1;
  console.log(`   ✅ Composited in ${compDuration}ms! Final size: ${finalJpeg.length} bytes.`);

  // 5. Save final result
  const finalPath = path.join(outputDir, 'sample_final.jpg');
  fs.writeFileSync(finalPath, finalJpeg);
  console.log(`   Final photo saved to: ${finalPath}`);

  console.log('\n====================================================');
  console.log('   🎉 COMPLETE PHOTOBOOTH PIPELINE SUCCEEDED!');
  console.log('====================================================\n');
  console.log('You can open and inspect each stage in macOS Preview:');
  console.log(`  1. Original Photo:  open "${inputPath}"`);
  console.log(`  2. Bedrock Cutout:  open "${cutoutPath}"`);
  console.log(`  3. Finished Photo:  open "${finalPath}"\n`);
}

processSamplePhoto().catch((err) => {
  console.error('\n❌ Pipeline failed:', err);
  process.exit(1);
});
