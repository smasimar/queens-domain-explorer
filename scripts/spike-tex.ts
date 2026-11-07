import { PakFile } from "../src/ue/pak.ts";
import { gamePathToPak, loadPackage } from "../src/ue/assets.ts";
import { parseTexture2D } from "../src/ue/texture.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const formats = new Map<string, number>();
const texPaths = [...pak.entries.keys()].filter((p) => /RuinsLevel\/Textures\/.*\.uasset$|OtherWorld\/.*_(D|TX|N)\.uasset$/.test(p)).slice(0, 400);
let ok = 0, fail = 0;
for (const p of texPaths) {
  try {
    const pkg = await loadPackage(pak, p.replace(/\.uasset$/, ""));
    if (!pkg.exports.some((e) => pkg.exportClass(e) === "Texture2D")) continue;
    const t = parseTexture2D(pkg);
    formats.set(t.format, (formats.get(t.format) ?? 0) + 1);
    if (ok++ < 4) console.log(t.name, t.format, t.srgb, t.isNormalMap, t.mips.map((m) => `${m.width}x${m.height}:${m.data.length}`).join(" "));
  } catch (e) { if (fail++ < 5) console.log("FAIL", p, (e as Error).message); }
}
console.log({ ok, fail }, formats);
