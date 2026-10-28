import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { compositePhoto } from '../src/composite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runLocalCompositingDemo() {
  console.log('====================================================');
  console.log('       Local Compositing Runner (Sharp Engine)');
  console.log('====================================================\n');

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 1. Prepare Background (1920x1080 stylish gradient)
  console.log('1. Creating 1920x1080 background...');
  const svgBg = `
    <svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#0f2027;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#203a43;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#2c5364;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="1920" height="1080" fill="url(#grad)" />
      <circle cx="960" cy="540" r="400" fill="#ffffff" opacity="0.04" />
    </svg>
  `;
  const backgroundBuffer = await sharp(Buffer.from(svgBg)).jpeg({ quality: 95 }).toBuffer();

  // 2. Prepare Cutout (Use Bedrock cutout if available, else synthetic cutout)
  console.log('2. Loading cutout image...');
  const bedrockCutoutPath = path.join(outputDir, 'bedrock_cutout_test.png');
  let cutoutBuffer: Buffer;

  if (fs.existsSync(bedrockCutoutPath)) {
    console.log(`   Found Bedrock test cutout at ${bedrockCutoutPath}`);
    cutoutBuffer = fs.readFileSync(bedrockCutoutPath);
  } else {
    console.log('   Generating synthetic cutout (guest silhouette)...');
    const svgCutout = `
      <svg width="600" height="800" viewBox="0 0 600 800" xmlns="http://www.w3.org/2000/svg">
        <circle cx="300" cy="250" r="140" fill="#f6ad55" />
        <path d="M 120 700 C 120 450, 480 450, 480 700 Z" fill="#4299e1" />
      </svg>
    `;
    cutoutBuffer = await sharp(Buffer.from(svgCutout)).png().toBuffer();
  }

  // 3. Prepare Frame (1920x1080 transparent PNG with ARCUS branding frame)
  console.log('3. Creating 1920x1080 overlay frame...');
  const svgFrame = `
    <svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
      <!-- Decorative Border -->
      <rect x="40" y="40" width="1840" height="1000" fill="none" stroke="#f6ad55" stroke-width="12" rx="30" />
      <rect x="60" y="60" width="1800" height="960" fill="none" stroke="#ffffff" stroke-width="2" rx="20" opacity="0.5" />
      <!-- Footer Banner -->
      <rect x="710" y="960" width="500" height="70" rx="15" fill="#1a202c" opacity="0.9" />
      <text x="960" y="1008" font-family="sans-serif" font-size="32" font-weight="bold" fill="#f6ad55" text-anchor="middle">
        ARCUS PHOTOBOOTH
      </text>
    </svg>
  `;
  const frameBuffer = await sharp(Buffer.from(svgFrame)).png().toBuffer();

  // 4. Composite: Background -> Cutout -> Frame
  console.log('4. Compositing layers (Background -> Cutout -> Frame)...');
  const startTime = Date.now();
  const resultJpeg = await compositePhoto({
    backgroundBuffer,
    cutoutBuffer,
    frameBuffer,
  });
  const duration = Date.now() - startTime;
  console.log(`   Composited in ${duration}ms! Result size: ${resultJpeg.length} bytes.`);

  // 5. Save output
  const outputPath = path.join(outputDir, 'composite_result.jpg');
  fs.writeFileSync(outputPath, resultJpeg);
  console.log(`\n5. ✅ Output saved to: ${outputPath}`);
  console.log('\n====================================================');
  console.log('   🎉 LOCAL COMPOSITING TEST COMPLETE!');
  console.log('====================================================\n');
}

runLocalCompositingDemo();
