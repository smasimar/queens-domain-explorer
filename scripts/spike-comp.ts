import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { readProps } from "../src/ue/properties.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const pkg = await loadPackage(pak, `QueensDomain/Content/RuinsLevel/Maps/${Deno.args[0]}`);
const actorRe = new RegExp(Deno.args[1]);
pkg.exports.forEach((e, i) => {
  const outer = pkg.exports[e.outerIndex - 1];
  const isActor = actorRe.test(e.objectName) && e.outerIndex > 0 && pkg.exportClass(pkg.exports[e.outerIndex - 1]) === "Level";
  if (!isActor && !(outer && actorRe.test(outer.objectName))) return;
  const p = readProps(pkg.exportReader(e), pkg);
  delete p.CustomPrimitiveData; delete p.UCSModifiedProperties; delete p.BodyInstance;
  console.log(i + 1, pkg.exportClass(e), e.objectName, "outer=" + pkg.indexName(e.outerIndex), "tmpl=" + pkg.indexName(e.templateIndex),
    JSON.stringify(p, (k, v) => (v && typeof v === "object" && "ref" in v) ? `${pkg.indexName(v.ref)}(${v.ref})` : v).slice(0, 2500));
});
