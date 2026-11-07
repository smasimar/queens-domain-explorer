import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { readProps } from "../src/ue/properties.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";

const level = Deno.args[0] ?? "100_GR";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const pkg = await loadPackage(pak, `QueensDomain/Content/RuinsLevel/Maps/${level}`);

const byOuter = new Map<string, { n: number; withMesh: number }>();
const meshes = new Map<string, number>();
let sample = 0;
for (const e of pkg.exports) {
  if (pkg.exportClass(e) !== "StaticMeshComponent") continue;
  const outer = pkg.exports[e.outerIndex - 1];
  const oc = outer ? pkg.exportClass(outer) : "?";
  const props = readProps(pkg.exportReader(e), pkg);
  const sm = props.StaticMesh as { ref: number } | undefined;
  const s = byOuter.get(oc) ?? { n: 0, withMesh: 0 };
  s.n++;
  if (sm && sm.ref) s.withMesh++;
  byOuter.set(oc, s);
  if (oc === "StaticMeshActor" && sm?.ref) {
    const p = pkg.importPath(sm.ref);
    meshes.set(p, (meshes.get(p) ?? 0) + 1);
    
  }
}
console.log([...byOuter].sort((a, b) => b[1].n - a[1].n).slice(0, 400).map(([k,v])=>`${k} ${v.n}/${v.withMesh}`).join("  "));
console.log(`distinct meshes on StaticMeshActors: ${meshes.size}`);
console.log([...meshes].sort((a, b) => b[1] - a[1]).slice(0, 30));
