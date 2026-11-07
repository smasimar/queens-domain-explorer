import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const pkg = await loadPackage(pak, `QueensDomain/Content/RuinsLevel/Maps/${Deno.args[0]}`);
const re = new RegExp(Deno.args[1] ?? "StaticMesh|BlueprintGeneratedClass");
for (let i = 0; i < pkg.imports.length; i++) {
  const imp = pkg.imports[i];
  if (!re.test(imp.className)) continue;
  const path = pkg.importPath(-i - 1);
  const base = "QueensDomain/Content/" + path.split(".")[0].replace("/Game/", "");
  const mb = (pak.entries.get(base + ".uexp")?.size ?? 0) / 1e6;
  console.log(imp.className, path, mb.toFixed(2) + "MB");
}
