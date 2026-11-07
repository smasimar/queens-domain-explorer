import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { readProps } from "../src/ue/properties.ts";
import { isLevelGeometryMesh } from "../src/ue/level.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const levels = Deno.args.length ? Deno.args : ["050_Ocean", "060_Ocean_Shadow", "070_UpperShell", "100_GR", "130_GR_outerisles", "140_GR_ShopIsleOnly"];
const sizeOf = (meshPath: string) => {
  const base = "QueensDomain/Content/" + meshPath.split(".")[0].replace("/Game/", "");
  return pak.entries.get(base + ".uexp")?.size ?? 0;
};
for (const level of levels) {
  const pkg = await loadPackage(pak, `QueensDomain/Content/RuinsLevel/Maps/${level}`);
  const rows = new Map<string, { n: number; size: number; reason: string }>();
  for (const e of pkg.exports) {
    const cls = pkg.exportClass(e);
    if (!/StaticMeshComponent/.test(cls)) continue;
    const outer = pkg.exports[e.outerIndex - 1];
    const oc = outer ? pkg.exportClass(outer) : "?";
    const p = readProps(pkg.exportReader(e), pkg);
    const ref = (p.StaticMesh as { ref: number } | undefined)?.ref ?? 0;
    if (ref >= 0) continue;
    const mesh = pkg.importPath(ref);
    const geoActor = oc === "StaticMeshActor" || oc === "FS_StaticMeshActor_C";
    const reason = !geoActor ? `actor:${oc}/${cls}` : !isLevelGeometryMesh(mesh) ? "pathfilter" : (p.bVisible === false || p.bHiddenInGame === true) ? "hidden" : "";
    if (!reason) continue;
    const key = `${reason} ${mesh.split(".").pop()}`;
    const r = rows.get(key) ?? { n: 0, size: sizeOf(mesh), reason };
    r.n++; rows.set(key, r);
  }
  const top = [...rows].sort((a, b) => b[1].size - a[1].size).slice(0, 15);
  console.log(`== ${level}`);
  for (const [k, v] of top) console.log(`  ${(v.size / 1e6).toFixed(2)}MB x${v.n} ${k}`);
}
