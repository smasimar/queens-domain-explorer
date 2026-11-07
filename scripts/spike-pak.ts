import { PakFile } from "../src/ue/pak.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";

const pak = await PakFile.open(await DenoFileSource.open(Deno.args[0] ?? DEFAULT_PAK));
console.log(`version=${pak.version} mount=${pak.mountPoint} entries=${pak.entries.size}`);
const maps = [...pak.entries.keys()].filter((p) => p.includes("RuinsLevel/Maps/") && /\.(umap)$/.test(p));
console.log(maps.join("\n"));
const ini = [...pak.entries.keys()].find((p) => p.endsWith("DefaultEngine.ini"))!;
const txt = new TextDecoder().decode(await pak.readFile(ini));
console.log(txt.split("\n").filter((l) => /Map|Version/i.test(l)).slice(0, 10).join("\n"));
