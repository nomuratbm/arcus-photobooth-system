import sharp from 'sharp';
import type { CompositingAssets, CompositingDimensions } from './types.js';

export interface CompositePhotoOptions {
  /** Target canvas dimensions if overriding background image dimensions */
  dimensions?: CompositingDimensions;
  /** Output JPEG quality (1-100, default 90) */
  quality?: number;
  /** Relative scale factor for cutout compared to background height (default 0.90) */
  cutoutScale?: number;
}

/**
 * Composites the photobooth image in the exact order:
 * 1. Background image (base)
 * 2. Cutout transparent PNG (middle, resized and centered)
 * 3. Frame transparent PNG (top overlay, stretched/fitted to canvas)
 *
 * @param assets - { backgroundBuffer, cutoutBuffer, frameBuffer }
 * @param options - Optional composite options
 * @returns Promise<Buffer> - Composited JPEG buffer
 */
export async function compositePhoto(
  assets: CompositingAssets,
  options: CompositePhotoOptions = {}
): Promise<Buffer> {
  const { backgroundBuffer, cutoutBuffer, frameBuffer } = assets;
  const quality = options.quality ?? 90;
  const cutoutScale = options.cutoutScale ?? 0.9;

  // 1. Get background dimensions
  const bgMetadata = await sharp(backgroundBuffer).metadata();
  const canvasWidth = options.dimensions?.width ?? bgMetadata.width;
  const canvasHeight = options.dimensions?.height ?? bgMetadata.height;

  if (!canvasWidth || !canvasHeight) {
    throw new Error('Could not determine canvas dimensions from background image.');
  }

  // Ensure base background image is scaled to target canvas dimensions
  const baseBackground = sharp(backgroundBuffer).resize(canvasWidth, canvasHeight, {
    fit: 'cover',
    position: 'center',
  });

  // 2. Prepare cutout (scale to fit canvas nicely, maintaining aspect ratio)
  const maxCutoutWidth = Math.round(canvasWidth * 0.95);
  const maxCutoutHeight = Math.round(canvasHeight * cutoutScale);

  const resizedCutoutBuffer = await sharp(cutoutBuffer)
    .resize(maxCutoutWidth, maxCutoutHeight, {
      fit: 'inside',
      withoutEnlargement: false,
    })
    .toBuffer();

  const cutoutMeta = await sharp(resizedCutoutBuffer).metadata();
  const cutoutWidth = cutoutMeta.width ?? maxCutoutWidth;
  const cutoutHeight = cutoutMeta.height ?? maxCutoutHeight;

  // Center horizontally, align bottom with slight margin (or center vertically)
  const cutoutLeft = Math.max(0, Math.round((canvasWidth - cutoutWidth) / 2));
  // Photobooth portrait: place cutout so it sits naturally towards bottom of canvas
  const bottomMargin = Math.max(0, Math.round(canvasHeight * 0.05));
  const cutoutTop = Math.max(0, canvasHeight - cutoutHeight - bottomMargin);

  // 3. Prepare frame (scaled to cover the exact canvas dimensions)
  const resizedFrameBuffer = await sharp(frameBuffer)
    .resize(canvasWidth, canvasHeight, {
      fit: 'fill',
    })
    .toBuffer();

  // 4. Layer compositing: Background -> Cutout -> Frame
  const compositedJpeg = await baseBackground
    .composite([
      {
        input: resizedCutoutBuffer,
        top: cutoutTop,
        left: cutoutLeft,
      },
      {
        input: resizedFrameBuffer,
        top: 0,
        left: 0,
      },
    ])
    .jpeg({
      quality,
      mozjpeg: true,
    })
    .toBuffer();

  return compositedJpeg;
}
