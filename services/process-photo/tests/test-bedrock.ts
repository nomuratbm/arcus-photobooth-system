import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { removeBackgroundWithBedrock } from '../src/bedrock.js';
import { getConfig } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runBedrockDiagnostic() {
  console.log('====================================================');
  console.log('   Bedrock Background Removal Diagnostic Test');
  console.log('====================================================\n');

  const config = getConfig();
  console.log(`Region:   ${config.bedrockRegion}`);
  console.log(`Model ID: ${config.bedrockModelId}\n`);

  console.log('1. Generating 512x512 sample test image with Sharp...');
  // Create an SVG circle on a background
  const svgSubject = `
    <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" fill="#2d3748"/>
      <circle cx="256" cy="200" r="100" fill="#e53e3e"/>
      <ellipse cx="256" cy="380" rx="140" ry="80" fill="#3182ce"/>
    </svg>
  `;

  const inputJpg = await sharp(Buffer.from(svgSubject))
    .jpeg({ quality: 90 })
    .toBuffer();

  console.log(`   Sample image generated (${inputJpg.length} bytes).`);

  console.log('\n2. Calling Bedrock Stability AI Remove Background...');
  const startTime = Date.now();

  try {
    const cutoutPng = await removeBackgroundWithBedrock(inputJpg);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`   Success! Bedrock responded in ${duration}s.`);
    console.log(`   Cutout size: ${cutoutPng.length} bytes.`);

    console.log('\n3. Validating cutout transparency with Sharp...');
    const metadata = await sharp(cutoutPng).metadata();
    console.log(`   Format:   ${metadata.format}`);
    console.log(`   Width:    ${metadata.width}`);
    console.log(`   Height:   ${metadata.height}`);
    console.log(`   Channels: ${metadata.channels} (channels === 4 indicates alpha channel)`);
    console.log(`   HasAlpha: ${metadata.hasAlpha}`);

    if (!metadata.hasAlpha) {
      console.warn('   ⚠️ Warning: Cutout does not seem to have an alpha channel.');
    } else {
      console.log('   ✅ Valid transparent PNG cutout confirmed!');
    }

    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, 'bedrock_cutout_test.png');
    fs.writeFileSync(outputPath, cutoutPng);
    console.log(`\n4. Cutout saved to: ${outputPath}`);
    console.log('\n====================================================');
    console.log('   🎉 BEDROCK BACKGROUND REMOVAL IS FULLY WORKING!');
    console.log('====================================================\n');
  } catch (error: any) {
    console.error('\n❌ Bedrock call failed:');
    console.error(error.message);
    process.exit(1);
  }
}

runBedrockDiagnostic();
