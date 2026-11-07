import { PakFile } from "../src/ue/pak.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const re = new RegExp(Deno.args[0], "i");
for (const [p, e] of pak.entries) if (re.test(p)) console.log((e.size / 1024).toFixed(0).padStart(7) + "K", p);
