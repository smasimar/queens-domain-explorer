import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { readProps } from "../src/ue/properties.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const pkg = await loadPackage(pak, `QueensDomain/Content/RuinsLevel/Maps/${Deno.args[0]}`);
const filter = Deno.args[1] ? new RegExp(Deno.args[1]) : null;
pkg.exports.forEach((e, i) => {
  const cls = pkg.exportClass(e);
  if (filter && !filter.test(cls)) return;
  let props = "";
  try { props = JSON.stringify(readProps(pkg.exportReader(e), pkg), (k, v) => (v && typeof v === "object" && "ref" in v) ? pkg.indexName(v.ref) : v).slice(0, 300); } catch (err) { props = "ERR " + (err as Error).message; }
  console.log(`${i + 1} ${cls} ${e.objectName} outer=${pkg.indexName(e.outerIndex)} size=${e.serialSize} ${props}`);
});
console.log("imports:", pkg.imports.filter(i => /Mesh|Material|Class/.test(i.className)).map(i => `${i.className}:${i.objectName}`).join(" ").slice(0, 2500));
