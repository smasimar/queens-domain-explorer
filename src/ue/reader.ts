/** Little-endian binary reader over a Uint8Array. */
export class Reader {
  readonly view: DataView;
  pos = 0;

  constructor(readonly bytes: Uint8Array, pos = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }

  get length(): number {
    return this.bytes.byteLength;
  }
  get remaining(): number {
    return this.bytes.byteLength - this.pos;
  }

  skip(n: number): void {
    this.pos += n;
  }
  u8(): number {
    return this.view.getUint8(this.pos++);
  }
  i8(): number {
    return this.view.getInt8(this.pos++);
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** int64 as JS number (safe up to 2^53). */
  i64(): number {
    const v = this.view.getBigInt64(this.pos, true);
    this.pos += 8;
    return Number(v);
  }
  u64big(): bigint {
    const v = this.view.getBigUint64(this.pos, true);
    this.pos += 8;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** UE bool serialized as uint32. */
  bool32(): boolean {
    const v = this.u32();
    if (v > 1) throw new Error(`Invalid bool32 ${v} at ${this.pos - 4}`);
    return v === 1;
  }
  take(n: number): Uint8Array {
    if (n < 0 || this.pos + n > this.length) throw new Error(`take(${n}) out of range at ${this.pos}/${this.length}`);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  guid(): string {
    const b = this.take(16);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  fstring(): string {
    const len = this.i32();
    if (len === 0) return "";
    if (len > 0) {
      if (len > 65536) throw new Error(`FString too long (${len}) at ${this.pos - 4}`);
      const b = this.take(len);
      let s = "";
      for (let i = 0; i < len - 1; i++) s += String.fromCharCode(b[i]);
      return s;
    }
    const n = -len;
    if (n > 65536) throw new Error(`FString too long (${n}) at ${this.pos - 4}`);
    let s = "";
    for (let i = 0; i < n; i++) {
      const c = this.u16();
      if (i < n - 1) s += String.fromCharCode(c);
    }
    return s;
  }
  array<T>(fn: () => T): T[] {
    const n = this.i32();
    if (n < 0 || n > 10_000_000) throw new Error(`Bad array count ${n} at ${this.pos - 4}`);
    const out: T[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = fn();
    return out;
  }
}
