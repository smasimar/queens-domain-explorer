import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { readProps } from "../src/ue/properties.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";

const level = Deno.args[0] ?? "100_GR";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const pkg = await loadPackage(pak, `QueensDomain/Content/RuinsLevel/Maps/${level}`);
const meshes = new Map<string, number>();
for (const e of pkg.exports) {
  if (pkg.exportClass(e) !== "StaticMeshComponent") continue;
  const outer = pkg.exports[e.outerIndex - 1];
  const oc = outer ? pkg.exportClass(outer) : "?";
  if (!/StaticMeshActor/.test(oc)) continue;
  const props = readProps(pkg.exportReader(e), pkg);
  const sm = props.StaticMesh as { ref: number } | undefined;
  if (!sm?.ref) continue;
  const p = pkg.importPath(sm.ref);
  meshes.set(p, (meshes.get(p) ?? 0) + 1);
}
console.log([...meshes].sort((a, b) => b[1] - a[1]));
const models = pkg.exports.filter((e) => pkg.exportClass(e) === "Model").map((e) => `${e.objectName}:${e.serialSize}`);
console.log("Model exports:", models.join(" "));
const big = [...pkg.exports].sort((a, b) => b.serialSize - a.serialSize).slice(0, 15)
  .map((e) => `${pkg.exportClass(e)}/${e.objectName}:${e.serialSize}`);
console.log("largest exports:", big.join("\n"));
