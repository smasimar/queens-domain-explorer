/**
 * Local converted-asset cache in the Origin Private File System.
 * Data never leaves the user's machine.
 */

type Packed = { __ta: string; off: number; len: number };
const TA: Record<string, { new (b: ArrayBuffer, o: number, l: number): ArrayBufferView; BYTES_PER_ELEMENT: number }> = {
  Float32Array: Float32Array as never,
  Uint32Array: Uint32Array as never,
  Uint16Array: Uint16Array as never,
  Uint8Array: Uint8Array as never,
};

/** Serialize an object containing typed arrays to one buffer. */
export function pack(obj: unknown): Uint8Array {
  const bufs: ArrayBufferView[] = [];
  let off = 0;
  const json = JSON.stringify(obj, (_k, v) => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const name = v.constructor.name;
      off = Math.ceil(off / 8) * 8;
      const p: Packed = { __ta: name, off, len: (v as Uint8Array).length };
      bufs.push(v);
      off += v.byteLength;
      return p;
    }
    return v;
  });
  const head = new TextEncoder().encode(json);
  const headLen = Math.ceil((4 + head.length) / 8) * 8;
  const out = new Uint8Array(headLen + off);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  let o = 0;
  for (const b of bufs) {
    o = Math.ceil(o / 8) * 8;
    out.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), headLen + o);
    o += b.byteLength;
  }
  return out;
}

export function unpack<T>(data: Uint8Array): T {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const len = new DataView(buf).getUint32(0, true);
  const headLen = Math.ceil((4 + len) / 8) * 8;
  const json = new TextDecoder().decode(new Uint8Array(buf, 4, len));
  return JSON.parse(json, (_k, v) => {
    if (v && typeof v === "object" && "__ta" in v) {
      const p = v as Packed;
      return new TA[p.__ta](buf, headLen + p.off, p.len);
    }
    return v;
  }) as T;
}

function fileName(key: string): string {
  return key.replace(/[^A-Za-z0-9_.-]/g, (c) => "~" + c.charCodeAt(0).toString(16));
}

export class AssetCache {
  private constructor(private readonly dir: FileSystemDirectoryHandle | null) {}

  static async open(ns: string): Promise<AssetCache> {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("cache-" + ns, { create: true });
      return new AssetCache(dir);
    } catch {
      return new AssetCache(null); // OPFS unavailable: cache disabled
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    if (!this.dir) return null;
    try {
      const fh = await this.dir.getFileHandle(fileName(key));
      return new Uint8Array(await (await fh.getFile()).arrayBuffer());
    } catch {
      return null;
    }
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    if (!this.dir) return;
    try {
      const fh = await this.dir.getFileHandle(fileName(key), { create: true });
      const w = await fh.createWritable();
      await w.write(data as unknown as BufferSource);
      await w.close();
    } catch {
      /* quota or unsupported: ignore */
    }
  }
}

export async function readLastNamespace(): Promise<string | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle("last-ns.txt");
    return (await (await fh.getFile()).text()) || null;
  } catch {
    return null;
  }
}

export async function writeLastNamespace(ns: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle("last-ns.txt", { create: true });
    const w = await fh.createWritable();
    await w.write(ns);
    await w.close();
  } catch {
    /* ignore */
  }
}

export async function clearAllCaches(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  // deno-lint-ignore no-explicit-any
  for await (const name of (root as any).keys() as AsyncIterable<string>) {
    await root.removeEntry(name, { recursive: true });
  }
}
