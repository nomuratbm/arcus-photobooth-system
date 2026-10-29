import sharp from 'sharp';
import { FRAME_LAYOUT } from './frame-layout.js';
import type { SlotInput } from './types.js';

export interface SubtleBackgroundOptions {
  /** Gaussian blur radius applied to the background (default 8). */
  blurSigma?: number;
  /** Brightness multiplier to dim the background (default 0.85). */
  brightness?: number;
  /** Saturation multiplier to mute the background (default 0.55). */
  saturation?: number;
}

export interface CompositeStripOptions {
  /** Output JPEG quality (1-100, default 90). */
  quality?: number;
  /** Fraction of a slot's height the cutout may occupy (default 0.96). */
  cutoutScale?: number;
  /** How strongly to mute the background so the foreground pops. */
  subtle?: SubtleBackgroundOptions;
}

const DEFAULT_SUBTLE: Required<SubtleBackgroundOptions> = {
  blurSigma: 8,
  brightness: 0.85,
  saturation: 0.55,
};

/**
 * Builds one slot tile: a subtle (blurred, dimmed, desaturated) background with
 * the person cutout layered on top, sized exactly to the slot rectangle.
 */
async function buildSlotTile(
  slot: SlotInput,
  rectWidth: number,
  rectHeight: number,
  cutoutScale: number,
  subtle: Required<SubtleBackgroundOptions>
): Promise<Buffer> {
  // 1. Background: cover-fit to the slot, then mute it so it stays subtle.
  const subtleBackground = await sharp(slot.backgroundBuffer)
    .resize(rectWidth, rectHeight, { fit: 'cover', position: 'center' })
    .blur(subtle.blurSigma)
    .modulate({ brightness: subtle.brightness, saturation: subtle.saturation })
    .png()
    .toBuffer();

  // 2. Cutout: fit inside the slot, keeping aspect ratio.
  const cutoutBuffer = await sharp(slot.cutoutBuffer)
    .resize(rectWidth, Math.round(rectHeight * cutoutScale), {
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  const cutoutMeta = await sharp(cutoutBuffer).metadata();
  const cutoutWidth = cutoutMeta.width ?? rectWidth;
  const cutoutHeight = cutoutMeta.height ?? rectHeight;

  // Center horizontally, rest towards the bottom of the slot.
  const left = Math.max(0, Math.round((rectWidth - cutoutWidth) / 2));
  const bottomMargin = Math.round(rectHeight * 0.02);
  const top = Math.max(0, rectHeight - cutoutHeight - bottomMargin);

  return sharp(subtleBackground)
    .composite([{ input: cutoutBuffer, left, top }])
    .png()
    .toBuffer();
}

/**
 * Composites the 3-shot photobooth strip:
 * 1. A transparent canvas at the frame layout size.
 * 2. For each slot: subtle background + person cutout, clipped to the slot.
 * 3. The baked frame overlay (decorations, borders, title) on top; its slot
 *    openings are transparent so the photos show through.
 *
 * @param overlayBuffer - Baked frame overlay PNG (transparent slot openings).
 * @param slots - One { backgroundBuffer, cutoutBuffer } per slot, in order.
 * @param options - Optional compositing options.
 * @returns Promise<Buffer> - Composited JPEG strip.
 */
export async function compositeStrip(
  overlayBuffer: Buffer,
  slots: SlotInput[],
  options: CompositeStripOptions = {}
): Promise<Buffer> {
  const quality = options.quality ?? 90;
  const cutoutScale = options.cutoutScale ?? 0.96;
  const subtle = { ...DEFAULT_SUBTLE, ...options.subtle };

  const { width, height, slots: rects } = FRAME_LAYOUT;

  if (slots.length !== rects.length) {
    throw new Error(
      `Expected ${rects.length} slot inputs but received ${slots.length}.`
    );
  }

  // Build each slot tile, then place it at its rectangle on the canvas.
  const layerInputs: sharp.OverlayOptions[] = [];
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    const tile = await buildSlotTile(
      slots[i],
      rect.width,
      rect.height,
      cutoutScale,
      subtle
    );
    layerInputs.push({ input: tile, left: rect.x, top: rect.y });
  }

  // Frame overlay on top, stretched to the exact canvas size.
  const overlay = await sharp(overlayBuffer)
    .resize(width, height, { fit: 'fill' })
    .png()
    .toBuffer();
  layerInputs.push({ input: overlay, left: 0, top: 0 });

  const canvas = sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  });

  return canvas
    .composite(layerInputs)
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}
