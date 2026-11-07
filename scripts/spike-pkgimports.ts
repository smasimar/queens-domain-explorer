import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
for (const a of Deno.args) {
  const pkg = await loadPackage(pak, "QueensDomain/Content/" + a);
  console.log(a, pkg.imports.filter((i) => i.className !== "Package").map((i, k) => `${i.className}:${i.objectName}`).join(" | "));
}
