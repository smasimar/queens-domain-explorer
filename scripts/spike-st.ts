import { PakFile } from "../src/ue/pak.ts";
import { loadPackage } from "../src/ue/assets.ts";
import { parseStringTable } from "../src/ue/stringtable.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const st = parseStringTable(await loadPackage(pak, "QueensDomain/Content/StringTables/ImportedStringTable"));
const re = new RegExp(Deno.args[0], "i");
for (const [k, v] of st) if (re.test(v)) console.log(k, "=>", v.slice(0, 300));
