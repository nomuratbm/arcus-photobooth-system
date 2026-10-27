import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { removeBackgroundWithBedrock } from '../src/bedrock.js';
import { compositePhoto } from '../src/composite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  // 3. Create a photobooth backdrop
  console.log('\n3. 🎨 Preparing photobooth background & frame...');
  const canvasWidth = 1920;
  const canvasHeight = 1080;

  // Background: Event stage backdrop
  const svgBg = `
    <svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="stageGlow" cx="50%" cy="30%" r="80%">
          <stop offset="0%" style="stop-color:#3a1c71;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#d76d77;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#ffaf7b;stop-opacity:1" />
        </radialGradient>
      </defs>
      <rect width="${canvasWidth}" height="${canvasHeight}" fill="url(#stageGlow)" />
      <!-- Bokeh lights -->
      <circle cx="300" cy="200" r="120" fill="#ffffff" opacity="0.1" />
      <circle cx="1600" cy="300" r="180" fill="#ffffff" opacity="0.1" />
      <circle cx="960" cy="700" r="250" fill="#ffffff" opacity="0.08" />
    </svg>
  `;
  const backgroundBuffer = await sharp(Buffer.from(svgBg)).jpeg({ quality: 95 }).toBuffer();

  // Frame: ARCUS event frame
  const svgFrame = `
    <svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      <!-- Outer Border -->
      <rect x="35" y="35" width="${canvasWidth - 70}" height="${canvasHeight - 70}" fill="none" stroke="#ffd700" stroke-width="14" rx="28" />
      <rect x="55" y="55" width="${canvasWidth - 110}" height="${canvasHeight - 110}" fill="none" stroke="#ffffff" stroke-width="2" rx="18" opacity="0.6" />
      
      <!-- Top Header Tag -->
      <rect x="${canvasWidth / 2 - 220}" y="20" width="440" height="55" rx="12" fill="#1a202c" />
      <text x="${canvasWidth / 2}" y="56" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="bold" fill="#ffd700" text-anchor="middle">
        ★ ARCUS PHOTOBOOTH ★
      </text>

      <!-- Bottom Event Banner -->
      <rect x="${canvasWidth / 2 - 300}" y="${canvasHeight - 95}" width="600" height="65" rx="15" fill="#1a202c" opacity="0.95" />
      <text x="${canvasWidth / 2}" y="${canvasHeight - 52}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="bold" fill="#ffffff" text-anchor="middle">
        AWS STUDENT BUILDER GROUP
      </text>
    </svg>
  `;
  const frameBuffer = await sharp(Buffer.from(svgFrame)).png().toBuffer();

  // 4. Composite: Background -> Cutout -> Frame
  console.log('\n4. 🖼️  Compositing layers (Background → Cutout → Frame)...');
  const t1 = Date.now();
  const finalJpeg = await compositePhoto(
    {
      backgroundBuffer,
      cutoutBuffer,
      frameBuffer,
    },
    {
      dimensions: { width: canvasWidth, height: canvasHeight },
      quality: 92,
      cutoutScale: 0.88,
    }
  );
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
