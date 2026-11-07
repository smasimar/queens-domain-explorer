import { Reader } from "./reader.ts";
import type { ByteSource } from "./source.ts";

const PAK_MAGIC = 0x5a6f12e1;
/** Serialized FPakEntry header size for an uncompressed v8+ entry. */
const ENTRY_HEADER_SIZE = 53;

export interface PakEntry {
  /** Offset of the FPakEntry header in the pak. */
  offset: number;
  size: number;
  uncompressedSize: number;
  compressionMethod: number;
  encrypted: boolean;
}

/**
 * UE4 pak reader (versions 10–11, unencrypted, uncompressed entries).
 * Paths are full virtual paths, e.g. "QueensDomain/Content/RuinsLevel/Maps/100_GR.umap".
 */
export class PakFile {
  readonly entries = new Map<string, PakEntry>();
  mountPoint = "";
  version = 0;

  private constructor(private readonly src: ByteSource) {}

  static async open(src: ByteSource): Promise<PakFile> {
    const pak = new PakFile(src);
    await pak.readIndex();
    return pak;
  }

  private async readIndex(): Promise<void> {
    const tailLen = Math.min(this.src.size, 512);
    const tail = await this.src.read(this.src.size - tailLen, tailLen);
    const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let magicAt = -1;
    for (let i = tailLen - 4; i >= 0; i--) {
      if (tv.getUint32(i, true) === PAK_MAGIC) {
        magicAt = i;
        break;
      }
    }
    if (magicAt < 0) throw new Error("Not a UE4 pak file (footer magic not found)");
    const f = new Reader(tail, magicAt - 17);
    f.skip(16); // encryption key guid
    const encryptedIndex = f.u8() !== 0;
    f.u32(); // magic
    this.version = f.i32();
    const indexOffset = f.i64();
    const indexSize = f.i64();
    if (encryptedIndex) throw new Error("Encrypted pak index is not supported");
    if (this.version < 10) throw new Error(`Pak version ${this.version} not supported (need 10+)`);

    const idx = new Reader(await this.src.read(indexOffset, indexSize));
    this.mountPoint = idx.fstring();
    idx.i32(); // NumEntries
    idx.u64big(); // PathHashSeed
    if (idx.bool32()) idx.skip(8 + 8 + 20); // path hash index (unused)
    if (!idx.bool32()) throw new Error("Pak has no full directory index");
    const dirOffset = idx.i64();
    const dirSize = idx.i64();
    idx.skip(20);
    const encodedLen = idx.i32();
    const encoded = idx.take(encodedLen);
    const loose: PakEntry[] = idx.array(() => readFullEntry(idx));

    const dir = new Reader(await this.src.read(dirOffset, dirSize));
    const mount = normalizeMount(this.mountPoint);
    const dirCount = dir.i32();
    for (let d = 0; d < dirCount; d++) {
      const dirName = dir.fstring();
      const fileCount = dir.i32();
      for (let i = 0; i < fileCount; i++) {
        const fileName = dir.fstring();
        const loc = dir.i32();
        if (loc === 0x7fffffff) continue; // deleted
        const entry = loc >= 0 ? decodeEntry(encoded, loc) : loose[-loc - 1];
        const path = (mount + dirName.replace(/^\//, "") + fileName).replace(/^\/+/, "");
        this.entries.set(path, entry);
      }
    }
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const e = this.entries.get(path);
    if (!e) throw new Error(`File not in pak: ${path}`);
    return this.readEntry(e);
  }

  async readEntry(e: PakEntry): Promise<Uint8Array> {
    if (e.encrypted) throw new Error("Encrypted entries are not supported");
    if (e.compressionMethod !== 0) throw new Error("Compressed entries are not supported");
    return this.src.read(e.offset + ENTRY_HEADER_SIZE, e.size);
  }
}

function normalizeMount(m: string): string {
  // "../../../" → "" (paths become relative to the project root's parent)
  let s = m.replace(/^(\.\.\/)+/, "");
  if (s && !s.endsWith("/")) s += "/";
  return s;
}

function readFullEntry(r: Reader): PakEntry {
  const offset = r.i64();
  const size = r.i64();
  const uncompressedSize = r.i64();
  const compressionMethod = r.u32();
  r.skip(20); // hash
  if (compressionMethod !== 0) r.array(() => r.skip(16));
  const flags = r.u8();
  r.u32(); // compression block size
  return { offset, size, uncompressedSize, compressionMethod, encrypted: (flags & 1) !== 0 };
}

function decodeEntry(buf: Uint8Array, at: number): PakEntry {
  const r = new Reader(buf, at);
  const bits = r.u32();
  if ((bits & 0x3f) === 0x3f) r.u32(); // explicit block size
  const compressionMethod = (bits >>> 23) & 0x3f;
  const offset = bits & (1 << 31) ? r.u32() : r.i64();
  const uncompressedSize = bits & (1 << 30) ? r.u32() : r.i64();
  let size = uncompressedSize;
  if (compressionMethod !== 0) size = bits & (1 << 29) ? r.u32() : r.i64();
  return { offset, size, uncompressedSize, compressionMethod, encrypted: (bits & (1 << 22)) !== 0 };
}
