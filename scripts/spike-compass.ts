import { PakFile } from "../src/ue/pak.ts";
import { gamePathToPak, loadPackage } from "../src/ue/assets.ts";
import { parseStaticMesh } from "../src/ue/staticmesh.ts";
import { parseTexture2D } from "../src/ue/texture.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const out = Deno.args[0];
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const m = parseStaticMesh(await loadPackage(pak, gamePathToPak("/Game/UI/HUD/Compass/Compass_SM")));
console.log("materials", m.materials, "sections", m.sections, "verts", m.positions.length / 3, "uvch", m.uvs.length);
const verts = [];
for (let i = 0; i < m.positions.length / 3; i++) verts.push([m.positions[i*3], m.positions[i*3+1], m.positions[i*3+2], m.uvs[0][i*2], m.uvs[0][i*2+1]]);
await Deno.writeTextFile(out + "/compass_mesh.json", JSON.stringify({ verts, indices: Array.from(m.indices), sections: m.sections }));
for (const t of ["/Game/UI/HUD/Compass/compass"]) {
  const tex = parseTexture2D(await loadPackage(pak, gamePathToPak(t)), 4096);
  const mip = tex.mips[0];
  console.log(t, tex.format, mip.width, mip.height);
  await Deno.writeFile(out + "/compass_tex.bin", mip.data);
  await Deno.writeTextFile(out + "/compass_tex.json", JSON.stringify({ format: tex.format, w: mip.width, h: mip.height }));
}
