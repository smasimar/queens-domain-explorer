/** Random-access byte source. Browser: a File. Scripts: a file handle. */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** HTTP Range source (dev only: reads the pak through the local dev server). */
export class HttpRangeSource implements ByteSource {
  private constructor(private readonly url: string, readonly size: number) {}

  static async open(url: string): Promise<HttpRangeSource> {
    const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
    const range = res.headers.get("Content-Range");
    const size = range ? Number(range.split("/")[1]) : Number(res.headers.get("Content-Length"));
    await res.body?.cancel();
    if (!size) throw new Error(`Cannot read size of ${url}`);
    return new HttpRangeSource(url, size);
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const res = await fetch(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (res.status !== 206) throw new Error(`Range request failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** Browser File / Blob source. Reads only the requested slice. */
export class BlobSource implements ByteSource {
  constructor(private readonly blob: Blob) {}
  get size(): number {
    return this.blob.size;
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    const buf = await this.blob.slice(offset, offset + length).arrayBuffer();
    return new Uint8Array(buf);
  }
}
