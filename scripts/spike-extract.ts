import { PakFile } from "../src/ue/pak.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const out = Deno.args[0];
for (const p of Deno.args.slice(1)) await Deno.writeFile(out + "/" + p.split("/").pop(), await pak.readFile(p));
