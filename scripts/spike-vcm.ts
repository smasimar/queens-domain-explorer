import { PakFile } from "../src/ue/pak.ts";
import { gamePathToPak, loadPackage } from "../src/ue/assets.ts";
import { parseLevelGeometry } from "../src/ue/level.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const path = Deno.args[0];
const pkg = await loadPackage(pak, gamePathToPak(path));
const counts = new Map<string, number>();
for (const e of pkg.exports) counts.set(pkg.exportClass(e), (counts.get(pkg.exportClass(e)) ?? 0) + 1);
console.log([...counts].sort((a, b) => b[1] - a[1]).slice(0, 25));
const placed = parseLevelGeometry(pkg);
for (const p of placed) {
  const base = gamePathToPak(p.mesh);
  console.log(((pak.entries.get(base + ".uexp")?.size ?? 0) / 1e6).toFixed(2) + "MB", p.mesh, p.xform.t.map((v) => v.toFixed(0)).join(","));
}
