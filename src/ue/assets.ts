import { Package } from "./package.ts";
import type { PakFile } from "./pak.ts";

/** Pak-relative root for "/Game/..." object paths. */
export const GAME_ROOT = "QueensDomain/Content/";

/** "/Game/Props/SM_Rock" → "QueensDomain/Content/Props/SM_Rock" (no extension). */
export function gamePathToPak(objectPath: string): string {
  const p = objectPath.split(".")[0];
  if (p.startsWith("/Game/")) return GAME_ROOT + p.slice("/Game/".length);
  if (p.startsWith("/Engine/")) return "Engine/Content/" + p.slice("/Engine/".length);
  throw new Error(`Unsupported object path: ${objectPath}`);
}

/** Load a cooked package (header + .uexp + optional .ubulk) from the pak. */
export async function loadPackage(pak: PakFile, basePath: string): Promise<Package> {
  const ext = pak.has(basePath + ".umap") ? ".umap" : ".uasset";
  const header = await pak.readFile(basePath + ext);
  const exports = await pak.readFile(basePath + ".uexp");
  const bulk = pak.has(basePath + ".ubulk") ? await pak.readFile(basePath + ".ubulk") : undefined;
  return new Package(basePath + ext, { header, exports, bulk });
}
