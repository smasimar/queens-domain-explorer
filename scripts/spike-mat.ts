import { PakFile } from "../src/ue/pak.ts";
import { gamePathToPak, loadPackage } from "../src/ue/assets.ts";
import { readProps } from "../src/ue/properties.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
for (const p of Deno.args) {
  const pkg = await loadPackage(pak, gamePathToPak(p));
  console.log("==", p, pkg.exports.map((e) => `${pkg.exportClass(e)}:${e.objectName}`).join(" "));
  console.log("imports:", pkg.imports.map((i) => `${i.className}:${i.objectName}`).join(" "));
  const e = pkg.exports.find((e) => /Material|Texture/.test(pkg.exportClass(e)))!;
  const r = pkg.exportReader(e);
  console.log(JSON.stringify(readProps(r, pkg)).slice(0, 1500));
  console.log("after props pos", r.pos, "of", r.length, Array.from(r.bytes.subarray(r.pos, r.pos + 64)).map(b=>b.toString(16).padStart(2,"0")).join(" "));
}
