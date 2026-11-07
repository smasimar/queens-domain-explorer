import { PakFile } from "../src/ue/pak.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const re = new RegExp(Deno.args[0], "i");
for (const p of pak.entries.keys()) if (re.test(p) && /\.(uasset|umap)$/.test(p)) console.log(p);
