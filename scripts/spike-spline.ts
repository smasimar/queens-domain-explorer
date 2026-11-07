import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { readProps } from "../src/ue/properties.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const pkg = await loadPackage(pak, `QueensDomain/Content/RuinsLevel/Maps/${Deno.args[0] ?? "500_AUT"}`);
const rows = new Map<string, number>();
let sample = 0;
for (const e of pkg.exports) {
  const cls = pkg.exportClass(e);
  if (!/Spline|Instanced/.test(cls)) continue;
  const outer = pkg.exports[e.outerIndex - 1];
  const r = pkg.exportReader(e);
  const p = readProps(r, pkg);
  const ref = (p.StaticMesh as { ref: number } | undefined)?.ref ?? 0;
  const mesh = ref < 0 ? pkg.importPath(ref).split(".").pop() : ref > 0 ? "export?" : "(template)";
  const key = `${cls} | ${outer ? pkg.exportClass(outer) : "?"} | ${mesh}`;
  rows.set(key, (rows.get(key) ?? 0) + 1);
  if (/Instanced/.test(cls) && sample++ < 2) console.log("ISM", Object.keys(p), "remaining", r.remaining, Array.from(r.bytes.subarray(r.pos, r.pos + 48)).map(b => b.toString(16).padStart(2, "0")).join(" "));
  if (/Spline/.test(cls) && sample++ < 4) console.log("SPL", JSON.stringify(p, (k, v) => (v && typeof v === "object" && "ref" in v) ? pkg.indexName(v.ref) : v).slice(0, 700));
}
for (const [k, v] of [...rows].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(v, k);
