import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const pkg = await loadPackage(pak, Deno.args[0]);
const c = new Map<string, number>();
for (const e of pkg.exports) c.set(pkg.exportClass(e), (c.get(pkg.exportClass(e)) ?? 0) + 1);
console.log([...c].sort((a, b) => b[1] - a[1]).slice(0, 40));
