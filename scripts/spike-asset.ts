import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { readProps } from "../src/ue/properties.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
for (const a of Deno.args) {
  const pkg = await loadPackage(pak, "QueensDomain/Content/" + a);
  for (const e of pkg.exports) {
    const r = pkg.exportReader(e);
    let p; try { p = readProps(r, pkg); } catch (err) { p = "ERR " + err; }
    console.log(a, pkg.exportClass(e), e.objectName, JSON.stringify(p, (k, v) => (v && typeof v === "object" && "ref" in v) ? pkg.indexName(v.ref) : v).slice(0, 1500), "rest=", r.remaining);
  }
}
