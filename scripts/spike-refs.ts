import { PakFile } from "../src/ue/pak.ts";
import { DEFAULT_PAK, DenoFileSource } from "./deno-source.ts";
const pak = await PakFile.open(await DenoFileSource.open(DEFAULT_PAK));
const needle = new TextEncoder().encode(Deno.args[0]);
const scope = new RegExp(Deno.args[1] ?? ".");
outer: for (const [p, e] of pak.entries) {
  if (!/\.(uasset|umap)$/.test(p) || !scope.test(p) || e.size > 4e6) continue;
  const b = await pak.readEntry(e);
  for (let i = 0; i + needle.length <= b.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) { ok = false; break; }
    if (ok) { console.log(p); continue outer; }
  }
}
