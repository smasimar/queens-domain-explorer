import { PakFile } from "../src/ue/pak.ts";
import { gamePathToPak, loadPackage } from "../src/ue/assets.ts";
import { parseStaticMesh } from "../src/ue/staticmesh.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";

const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const paths = Deno.args.length ? Deno.args : [
  "/Game/RuinsLevel/Models/RuinsLevel_00_Part_01A",
  "/Game/RuinsLevel/Shipwrecks/RL00_Shipwreck_00_SM",
  "/Game/Props/KE/KE_Bag_03_SM",
];
for (const p of paths) {
  try {
    const pkg = await loadPackage(pak, gamePathToPak(p));
    const m = parseStaticMesh(pkg);
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], m.positions[i + k]); max[k] = Math.max(max[k], m.positions[i + k]);
    }
    const maxIdx = m.indices.reduce((a, b) => Math.max(a, b), 0);
    console.log(m.name, `verts=${m.positions.length / 3} tris=${m.indices.length / 3} maxIdx=${maxIdx}`,
      `sections=${JSON.stringify(m.sections)}`, `uv0=${m.uvs[0].toFixed(3)},${m.uvs[1].toFixed(3)}`,
      `bounds=${min.map((v) => v.toFixed(0))}..${max.map((v) => v.toFixed(0))}`, `materials=${m.materials.join(", ")}`,
      `ubulk=${pkg.files.bulk?.length ?? 0}`);
  } catch (e) {
    console.log("FAIL", p, (e as Error).message);
  }
}
