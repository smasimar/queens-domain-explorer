import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { parseLevelGeometry } from "../src/ue/level.ts";
import { ALL_LEVELS } from "../src/viewer/zones.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const byActor = new Map<string, { n: number; mb: number; ex: string }>();
for (const l of ALL_LEVELS) {
  const pkg = await loadPackage(pak, `QueensDomain/Content/RuinsLevel/Maps/${l}`);
  const placed = parseLevelGeometry(pkg);
  // recover actor class per mesh by scanning components again (cheap enough)
  for (const e of pkg.exports) {
    if (pkg.exportClass(e) !== "StaticMeshComponent") continue;
    const outer = pkg.exports[e.outerIndex - 1];
    if (!outer) continue;
    const oc = pkg.exportClass(outer);
    if (oc === "StaticMeshActor" || oc === "FS_StaticMeshActor_C") continue;
    void placed;
  }
  for (const p of placed) {
    const base = "QueensDomain/Content/" + p.mesh.split(".")[0].replace("/Game/", "");
    const mb = (pak.entries.get(base + ".uexp")?.size ?? 0) / 1e6;
    const k = p.mesh.split("/").slice(2, 4).join("/");
    const r = byActor.get(k) ?? { n: 0, mb: 0, ex: p.mesh.split(".").pop()! };
    r.n++; r.mb += mb; byActor.set(k, r);
  }
}
for (const [k, v] of [...byActor].sort((a, b) => b[1].mb - a[1].mb).slice(0, 40)) console.log(`${v.mb.toFixed(1)}MB x${v.n} ${k} e.g. ${v.ex}`);
