/** CPU decoding of UE texture formats to RGBA8 (for UI images, not 3D textures). */

function rgb565(c: number, out: number[], o: number): void {
  out[o] = (((c >> 11) & 31) * 255 + 15) / 31 | 0;
  out[o + 1] = (((c >> 5) & 63) * 255 + 31) / 63 | 0;
  out[o + 2] = ((c & 31) * 255 + 15) / 31 | 0;
}

function colorBlock(src: Uint8Array, so: number, dst: Uint8ClampedArray, w: number, bx: number, by: number, dxt1: boolean): void {
  const c0 = src[so] | (src[so + 1] << 8);
  const c1 = src[so + 2] | (src[so + 3] << 8);
  const pal: number[] = new Array(16).fill(255);
  rgb565(c0, pal, 0);
  rgb565(c1, pal, 4);
  if (!dxt1 || c0 > c1) {
    for (let k = 0; k < 3; k++) {
      pal[8 + k] = (2 * pal[k] + pal[4 + k]) / 3 | 0;
      pal[12 + k] = (pal[k] + 2 * pal[4 + k]) / 3 | 0;
    }
  } else {
    for (let k = 0; k < 3; k++) pal[8 + k] = (pal[k] + pal[4 + k]) / 2 | 0;
    pal[12] = pal[13] = pal[14] = 0;
    pal[15] = 0;
  }
  const bits = src[so + 4] | (src[so + 5] << 8) | (src[so + 6] << 16) | (src[so + 7] << 24);
  for (let i = 0; i < 16; i++) {
    const idx = (bits >>> (2 * i)) & 3;
    const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
    const d = (y * w + x) * 4;
    dst[d] = pal[idx * 4];
    dst[d + 1] = pal[idx * 4 + 1];
    dst[d + 2] = pal[idx * 4 + 2];
    if (dxt1) dst[d + 3] = pal[idx * 4 + 3];
  }
}

function alphaBlock(src: Uint8Array, so: number, dst: Uint8ClampedArray, w: number, bx: number, by: number, channel: number): void {
  const a0 = src[so], a1 = src[so + 1];
  const pal = [a0, a1, 0, 0, 0, 0, 0, 0];
  if (a0 > a1) for (let i = 1; i < 7; i++) pal[i + 1] = ((7 - i) * a0 + i * a1) / 7 | 0;
  else {
    for (let i = 1; i < 5; i++) pal[i + 1] = ((5 - i) * a0 + i * a1) / 5 | 0;
    pal[6] = 0;
    pal[7] = 255;
  }
  let bits = 0n;
  for (let i = 0; i < 6; i++) bits |= BigInt(src[so + 2 + i]) << BigInt(8 * i);
  for (let i = 0; i < 16; i++) {
    const idx = Number((bits >> BigInt(3 * i)) & 7n);
    const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
    dst[(y * w + x) * 4 + channel] = pal[idx];
  }
}

/** Decode one mip level to RGBA8. Supports DXT1, DXT5, BC4, BC5, B8G8R8A8, G8. */
export function decodeToRGBA(format: string, data: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const bw = Math.max(4, w), bh = Math.max(4, h);
  const out = new Uint8ClampedArray(bw * bh * 4).fill(255);
  const blocksX = bw / 4, blocksY = bh / 4;
  let o = 0;
  switch (format) {
    case "PF_DXT1":
      for (let by = 0; by < blocksY; by++) for (let bx = 0; bx < blocksX; bx++, o += 8) colorBlock(data, o, out, bw, bx, by, true);
      break;
    case "PF_DXT5":
      for (let by = 0; by < blocksY; by++)
        for (let bx = 0; bx < blocksX; bx++, o += 16) {
          colorBlock(data, o + 8, out, bw, bx, by, false);
          alphaBlock(data, o, out, bw, bx, by, 3);
        }
      break;
    case "PF_BC4":
      for (let by = 0; by < blocksY; by++)
        for (let bx = 0; bx < blocksX; bx++, o += 8) {
          alphaBlock(data, o, out, bw, bx, by, 0);
          for (let i = 0; i < 16; i++) {
            const d = ((by * 4 + (i >> 2)) * bw + bx * 4 + (i & 3)) * 4;
            out[d + 1] = out[d + 2] = out[d];
          }
        }
      break;
    case "PF_BC5":
      for (let by = 0; by < blocksY; by++)
        for (let bx = 0; bx < blocksX; bx++, o += 16) {
          alphaBlock(data, o, out, bw, bx, by, 0);
          alphaBlock(data, o + 8, out, bw, bx, by, 1);
        }
      break;
    case "PF_B8G8R8A8":
      for (let i = 0; i < w * h; i++) {
        out[i * 4] = data[i * 4 + 2];
        out[i * 4 + 1] = data[i * 4 + 1];
        out[i * 4 + 2] = data[i * 4];
        out[i * 4 + 3] = data[i * 4 + 3];
      }
      return out;
    case "PF_G8":
      for (let i = 0; i < w * h; i++) out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = data[i];
      return out;
    default:
      throw new Error(`Cannot decode ${format}`);
  }
  if (bw === w && bh === h) return out;
  // Crop padded blocks (mips smaller than 4x4).
  const crop = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) crop.set(out.subarray(y * bw * 4, (y * bw + w) * 4), y * w * 4);
  return crop;
}
