import { PakFile } from "../src/ue/pak.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const rows = [...pak.entries].filter(([p]) => p.endsWith(".uexp") && /RuinsLevel\/Models|Terrain|OtherWorld/i.test(p))
  .sort((a, b) => b[1].size - a[1].size).slice(0, 25);
for (const [p, e] of rows) console.log((e.size / 1e6).toFixed(2) + "MB", p);
