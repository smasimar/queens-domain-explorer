import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { readProps } from "../src/ue/properties.ts";
import { parseStringTable } from "../src/ue/stringtable.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const st = parseStringTable(await loadPackage(pak, "QueensDomain/Content/StringTables/ImportedStringTable"));
console.log("strings", st.size);
const tx = (v: any) => v?.table ? st.get(v.key) ?? `?${v.key}` : v?.text ?? v;
for (const p of [...pak.entries.keys()].filter((p) => /Blueprints\/Areas\/[^/]+\/[^/]+\.uasset$/.test(p))) {
  const pkg = await loadPackage(pak, p.replace(/\.uasset$/, ""));
  const e = pkg.exports[0];
  const cls = pkg.exportClass(e);
  if (!/AreaName|Teleporter|Location/.test(cls)) continue;
  const pr: any = readProps(pkg.exportReader(e), pkg);
  if (!pr.TeleportDestTransform) continue;
  console.log(cls.padEnd(22), String(pr.LevelList).padEnd(14), String(pr.Sort).padStart(4), (pr.LocationType ?? "").replace("EFS_LocationType::", "").padEnd(16), tx(pr.Name), "|", tx(pr.AreaName), "|", pr.TeleportDestTransform.Translation.map((v: number) => v.toFixed(0)).join(","), p.split("/").slice(-2).join("/"));
}
