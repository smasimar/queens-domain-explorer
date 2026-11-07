import type { ByteSource } from "../src/ue/source.ts";

/** Deno file-handle source, used only by dev scripts. */
export class DenoFileSource implements ByteSource {
  private constructor(private readonly file: Deno.FsFile, readonly size: number) {}

  static async open(path: string): Promise<DenoFileSource> {
    const file = await Deno.open(path, { read: true });
    const st = await file.stat();
    return new DenoFileSource(file, st.size);
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    await this.file.seek(offset, Deno.SeekMode.Start);
    const out = new Uint8Array(length);
    let got = 0;
    while (got < length) {
      const n = await this.file.read(out.subarray(got));
      if (n === null) throw new Error("Unexpected EOF");
      got += n;
    }
    return out;
  }
}

export const DEFAULT_PAK =
  "C:/Games/Steam/steamapps/common/QueensDomain/QueensDomain/Content/Paks/QueensDomain-WindowsNoEditor.pak";
