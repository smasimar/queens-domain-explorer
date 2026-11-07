import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { parseTexture2D } from "../src/ue/texture.ts";
import { decodeToRGBA } from "../src/ue/decode.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const out = Deno.args[0];
const index: string[] = [];
for (const a of Deno.args.slice(1)) {
  try {
    const pkg = await loadPackage(pak, "QueensDomain/Content/" + a);
    if (!pkg.exports.some((e) => pkg.exportClass(e) === "Texture2D")) { console.log("not texture", a, pkg.exports.map(e=>pkg.exportClass(e)).join(",")); continue; }
    const t = parseTexture2D(pkg, 4096);
    const m = t.mips[0];
    const rgba = decodeToRGBA(t.format, m.data, m.width, m.height);
    const name = a.split("/").pop()!;
    await Deno.writeFile(`${out}/${name}.rgba`, new Uint8Array(rgba.buffer));
    index.push(`${name} ${m.width} ${m.height}`);
    console.log(name, t.format, m.width, m.height, t.srgb);
  } catch (e) { console.log("FAIL", a, (e as Error).message); }
}
await Deno.writeTextFile(`${out}/index.txt`, index.join("\n"));
