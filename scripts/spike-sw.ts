import { PakFile } from "../src/ue/pak.ts";
import { gamePathToPak, loadPackage } from "../src/ue/assets.ts";
import { parseLevelGeometry } from "../src/ue/level.ts";
import { linear } from "../src/ue/transform.ts";
import { parseStaticMesh } from "../src/ue/staticmesh.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const placed = parseLevelGeometry(await loadPackage(pak, gamePathToPak(`/Game/RuinsLevel/Maps/${Deno.args[0]}`)));
for (const p of placed.filter((p) => new RegExp(Deno.args[1]).test(p.mesh))) {
  const m = parseStaticMesh(await loadPackage(pak, gamePathToPak(p.mesh)));
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m.positions[i + k]); mx[k] = Math.max(mx[k], m.positions[i + k]); }
  console.log(p.mesh.split(".").pop(), "t=", p.xform.t.map((v) => v.toFixed(0)), "a=", linear(p.xform).map((v) => v.toFixed(2)).join(","), "localBounds", mn.map((v) => v.toFixed(0)), mx.map((v) => v.toFixed(0)));
}
