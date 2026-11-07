import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";

const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const levels = Deno.args.length ? Deno.args : ["Ruins_Level_00", "000_Shared_Base_Lighting", "100_GR", "130_GR_outerisles", "140_GR_ShopIsleOnly"];
for (const level of levels) {
  const pkg = await loadPackage(pak, `QueensDomain/Content/RuinsLevel/Maps/${level}`);
  const counts = new Map<string, number>();
  for (const e of pkg.exports) {
    const c = pkg.exportClass(e);
    if (/Mesh|Model|Brush|Landscape|Foliage|Level|World|PlayerStart/i.test(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  console.log(level, `exports=${pkg.exports.length}`, Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])));
}
