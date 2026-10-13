import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface ImageComparison {
  width: number;
  height: number;
  sizeMatches: boolean;
  /** Dimensions of each input, for diagnostics. */
  sizes: { a: [number, number]; b: [number, number] };
  diffPixels: number;
  /** Share of differing pixels over the padded canvas, 0..1. */
  diffRatio: number;
  /** 1 - diffRatio. */
  similarity: number;
  diffPng: Buffer;
}

function pad(png: PNG, width: number, height: number): Buffer {
  if (png.width === width && png.height === height) return png.data;
  const out = Buffer.alloc(width * height * 4, 0xff);
  for (let y = 0; y < png.height; y++) {
    png.data.copy(out, y * width * 4, y * png.width * 4, (y + 1) * png.width * 4);
  }
  return out;
}

/**
 * Pixel comparison with pixelmatch. Images of different sizes are padded with white to the
 * larger canvas, so missing or extra page height counts as difference rather than being ignored.
 */
export function comparePngs(a: Buffer, b: Buffer, threshold = 0.1): ImageComparison {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  const width = Math.max(pa.width, pb.width);
  const height = Math.max(pa.height, pb.height);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(pad(pa, width, height), pad(pb, width, height), diff.data, width, height, {
    threshold,
    includeAA: false,
  });
  const diffRatio = diffPixels / (width * height);
  return {
    width,
    height,
    sizeMatches: pa.width === pb.width && pa.height === pb.height,
    sizes: { a: [pa.width, pa.height], b: [pb.width, pb.height] },
    diffPixels,
    diffRatio,
    similarity: 1 - diffRatio,
    diffPng: PNG.sync.write(diff),
  };
}

/** Places images side by side (with a gutter) for reports. */

/** Crops an image to at most `maxHeight` pixels, keeping file sizes reasonable in reports. */
export function cropHeight(image: Buffer, maxHeight: number): Buffer {
  const png = PNG.sync.read(image);
  if (png.height <= maxHeight) return image;
  const out = new PNG({ width: png.width, height: maxHeight });
  PNG.bitblt(png, out, 0, 0, png.width, maxHeight, 0, 0);
  return PNG.sync.write(out);
}
