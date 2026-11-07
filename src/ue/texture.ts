import type { Package } from "./package.ts";
import { readProps } from "./properties.ts";
import { readBulkData } from "./staticmesh.ts";

export interface TextureMip {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface TextureData {
  name: string;
  /** UE pixel format, e.g. "PF_DXT1". */
  format: string;
  srgb: boolean;
  isNormalMap: boolean;
  /** Largest first; contiguous chain. */
  mips: TextureMip[];
}

/** Parse a cooked Texture2D. Mips larger than maxSize are skipped. */
export function parseTexture2D(pkg: Package, maxSize = 2048): TextureData {
  const exp = pkg.exports.find((e) => pkg.exportClass(e) === "Texture2D");
  if (!exp) throw new Error(`${pkg.path}: no Texture2D export`);
  const r = pkg.exportReader(exp);
  const props = readProps(r, pkg);
  if (r.bool32()) r.guid();
  r.skip(2); // UTexture strip flags
  r.skip(2); // UTexture2D strip flags
  if (!r.bool32()) throw new Error(`${pkg.path}: texture not cooked`);
  const pfName = pkg.fname(r);
  if (pfName === "None") throw new Error(`${pkg.path}: no platform data`);
  r.i64(); // skip offset
  r.i32(); // SizeX
  r.i32(); // SizeY
  const packed = r.u32();
  const format = r.fstring();
  if (packed & (1 << 30)) r.skip(8); // opt data
  r.i32(); // first mip to serialize
  const mipCount = r.i32();
  const mips: TextureMip[] = [];
  for (let i = 0; i < mipCount; i++) {
    r.bool32(); // cooked
    let data: Uint8Array | null = null;
    try {
      data = readBulkData(r, pkg);
    } catch {
      data = null;
    }
    const width = r.i32();
    const height = r.i32();
    r.i32(); // depth
    if (!data || data.length === 0) continue;
    if (Math.max(width, height) > maxSize) continue;
    mips.push({ width, height, data });
  }
  // Keep a contiguous chain (each mip half the previous).
  const chain: TextureMip[] = [];
  for (const m of mips) {
    const prev = chain[chain.length - 1];
    if (prev && (m.width !== Math.max(1, prev.width >> 1) || m.height !== Math.max(1, prev.height >> 1))) break;
    chain.push(m);
  }
  if (!chain.length) throw new Error(`${pkg.path}: no usable mips`);
  const compression = typeof props.CompressionSettings === "string" ? props.CompressionSettings : "";
  return {
    name: exp.objectName,
    format,
    srgb: props.SRGB !== false,
    isNormalMap: /Normalmap/i.test(compression),
    mips: chain,
  };
}
