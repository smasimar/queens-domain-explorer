import { PakFile } from "../src/ue/pak.ts";
import { gamePathToPak, loadPackage } from "../src/ue/assets.ts";
import { parseLevelGeometry, parsePersistentLevel } from "../src/ue/level.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";

const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const persistent = parsePersistentLevel(await loadPackage(pak, gamePathToPak("/Game/RuinsLevel/Maps/Ruins_Level_00")));
console.log("spawn", persistent.spawn);
for (const l of persistent.levels) {
  const nonIdentity = l.xform.t.some((v) => v !== 0) || l.xform.r.some((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) > 1e-6);
  console.log(l.name, l.packagePath, nonIdentity ? JSON.stringify(l.xform) : "");
}
let total = 0;
const unique = new Set<string>();
for (const name of Deno.args.length ? Deno.args : ["070_UpperShell", "100_GR", "130_GR_outerisles", "140_GR_ShopIsleOnly"]) {
  const placed = parseLevelGeometry(await loadPackage(pak, gamePathToPak(`/Game/RuinsLevel/Maps/${name}`)));
  total += placed.length;
  placed.forEach((p) => unique.add(p.mesh));
  console.log(name, placed.length, placed.slice(0, 2).map((p) => `${p.mesh.split(".").pop()} t=${p.xform.t.map((v) => v.toFixed(0))}`));
}
console.log(`placed=${total} unique meshes=${unique.size}`);
