import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const maps = [...pak.entries.keys()].filter((p) => /RuinsLevel\/Maps\/[^/]+\.umap$/.test(p));
for (const m of maps) {
  const pkg = await loadPackage(pak, m.replace(/\.umap$/, ""));
  const big = pkg.imports.filter((i) => i.className === "StaticMesh" && /RuinsLevel_00_Part_0\d$|OW_Env_0\d_SM$|Castle_00_SM$/.test(i.objectName)).map((i) => i.objectName);
  const ps = pkg.exports.filter((e) => pkg.exportClass(e) === "PlayerStart").length;
  if (big.length || ps) console.log(m.split("/").pop(), big.join(","), ps ? `PlayerStart=${ps}` : "");
}
