import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { compositeStrip } from '../src/composite.js';
import { FRAME_LAYOUT, SHOT_COUNT } from '../src/frame-layout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetsRoot = path.join(__dirname, '..', '..', '..', 'assets');

async function syntheticCutout(): Promise<Buffer> {
  const svgCutout = `
    <svg width="600" height="800" viewBox="0 0 600 800" xmlns="http://www.w3.org/2000/svg">
      <circle cx="300" cy="250" r="140" fill="#f6ad55" />
      <path d="M 120 700 C 120 450, 480 450, 480 700 Z" fill="#4299e1" />
    </svg>
  `;
  return sharp(Buffer.from(svgCutout)).png().toBuffer();
}

async function runLocalCompositingDemo() {
  console.log('====================================================');
  console.log('   Local 3-Shot Strip Compositing Runner (Sharp)');
  console.log('====================================================\n');

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 1. Frame overlay (baked from assets/frames/curated/default.svg)
  const overlayPath = path.join(assetsRoot, 'frames', 'curated', 'default.png');
  console.log(`1. Loading frame overlay: ${overlayPath}`);
  const overlayBuffer = fs.readFileSync(overlayPath);

  // 2. Backgrounds from the curated set
  const bgDir = path.join(assetsRoot, 'backgrounds', 'curated');
  const bgFiles = fs
    .readdirSync(bgDir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .slice(0, SHOT_COUNT);
  console.log(`2. Loading ${bgFiles.length} curated backgrounds: ${bgFiles.join(', ')}`);
  const backgrounds = bgFiles.map((f) => fs.readFileSync(path.join(bgDir, f)));

  // 3. Cutouts (Bedrock test cutout if present, else synthetic)
  console.log('3. Loading cutouts...');
  const bedrockCutoutPath = path.join(outputDir, 'bedrock_cutout_test.png');
  let cutoutBuffer: Buffer;
  if (fs.existsSync(bedrockCutoutPath)) {
    console.log(`   Found Bedrock test cutout at ${bedrockCutoutPath}`);
    cutoutBuffer = fs.readFileSync(bedrockCutoutPath);
  } else {
    console.log('   Generating synthetic cutouts (guest silhouette)...');
    cutoutBuffer = await syntheticCutout();
  }

  const slots = backgrounds.map((backgroundBuffer) => ({
    backgroundBuffer,
    cutoutBuffer,
  }));

  // 4. Composite: per-slot subtle background + cutout, frame overlay on top
  console.log('4. Compositing strip (slots -> overlay)...');
  const startTime = Date.now();
  const resultJpeg = await compositeStrip(overlayBuffer, slots);
  const duration = Date.now() - startTime;
  console.log(`   Composited in ${duration}ms! Result size: ${resultJpeg.length} bytes.`);

  const meta = await sharp(resultJpeg).metadata();
  console.log(
    `   Output dimensions: ${meta.width}x${meta.height} (layout ${FRAME_LAYOUT.width}x${FRAME_LAYOUT.height})`
  );

  // 5. Save output
  const outputPath = path.join(outputDir, 'composite_result.jpg');
  fs.writeFileSync(outputPath, resultJpeg);
  console.log(`\n5. Output saved to: ${outputPath}`);
  console.log('\n====================================================');
  console.log('   LOCAL COMPOSITING TEST COMPLETE!');
  console.log('====================================================\n');
}

runLocalCompositingDemo().catch((err) => {
  console.error('Local compositing failed:', err);
  process.exit(1);
});
