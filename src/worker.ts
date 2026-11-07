/// <reference lib="webworker" />
import { AssetCache, pack, unpack, writeLastNamespace } from "./cache.ts";
import type {
  GeometryData,
  LocationGroup,
  LocationPoint,
  MaterialData,
  SceneActor,
  SceneData,
  TextureData,
  UiAssets,
  UiImage,
  WorkerApi,
} from "./protocol.ts";
import { decodeToRGBA } from "./ue/decode.ts";
import { gamePathToPak, loadPackage } from "./ue/assets.ts";
import { parseLevelAltars, parseLevelGeometry, parsePersistentLevel, type PlacedAltar } from "./ue/level.ts";
import { type LocationAsset, parseLocationAsset } from "./ue/locations.ts";
import { parseStringTable } from "./ue/stringtable.ts";
import { resolveMaterial } from "./ue/material.ts";
import type { Package } from "./ue/package.ts";
import { PakFile } from "./ue/pak.ts";
import { BlobSource, HttpRangeSource } from "./ue/source.ts";
import { parseStaticMesh } from "./ue/staticmesh.ts";
import { parseTexture2D } from "./ue/texture.ts";
import { toThreeMatrix, ueToThreePoint, UNIT, type Xform } from "./ue/transform.ts";

/** Bump when parser output changes, to invalidate caches. */
const CACHE_VERSION = "v5";
const PERSISTENT = "/Game/RuinsLevel/Maps/Ruins_Level_00";
const STRING_TABLE = "/Game/StringTables/ImportedStringTable";
const ALTAR_MESH = {
  fasttravel: "/Game/RuinsLevel/Models/Teleporter_Preview_SM.Teleporter_Preview_SM",
  save: "/Game/LD45/Blueprints/Checkpoint/checkpoint_SM.checkpoint_SM",
};

let pak: PakFile | null = null;
let cache: AssetCache | null = null;
const pkgCache = new Map<string, Promise<Package | null>>();

function loadPkg(objectPath: string): Promise<Package | null> {
  const base = gamePathToPak(objectPath);
  let p = pkgCache.get(base);
  if (!p) {
    if (!pak) throw new Error("Pak file not open (asset not in cache). Select the .pak file.");
    const pk = pak;
    p = (async () => {
      const ext = pk.has(base + ".umap") ? ".umap" : ".uasset";
      if (!pk.has(base + ext)) return null;
      return loadPackage(pk, base);
    })();
    pkgCache.set(base, p);
    if (pkgCache.size > 96) pkgCache.delete(pkgCache.keys().next().value!);
  }
  return p;
}

async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const k = `${CACHE_VERSION}:${key}`;
  const hit = await cache?.get(k);
  if (hit) return unpack<T>(hit);
  const v = await compute();
  await cache?.put(k, pack(v));
  return v;
}

/** UE forward (local +X) of a transform, in three space. */
function threeForward(x: Xform): [number, number, number] {
  return [x.r[0], x.r[6], x.r[3]];
}

/** Group save / fast-travel points by area: fast travel first, then saves in game order. */
async function buildLocations(altars: { level: string; altar: PlacedAltar }[]): Promise<LocationGroup[]> {
  if (!pak) return [];
  const stPkg = await loadPkg(STRING_TABLE);
  const strings = stPkg ? parseStringTable(stPkg) : new Map<string, string>();
  const assets: LocationAsset[] = [];
  for (const path of pak.entries.keys()) {
    const m = /^QueensDomain\/Content\/Blueprints\/Areas\/[^/]+\/([^/]+)\.uasset$/.exec(path);
    if (!m) continue;
    const pkg = await loadPkg("/Game/" + path.slice("QueensDomain/Content/".length).replace(/\.uasset$/, ""));
    const a = pkg && parseLocationAsset(pkg, strings);
    if (a) assets.push(a);
  }
  // Unnamed areas ("???") take the fast-travel area name of the same folder.
  const folderArea = new Map(assets.filter((a) => a.kind === "fasttravel").map((a) => [a.folder, a.area]));
  for (const a of assets) if (!a.area || /^\?+$/.test(a.area)) a.area = folderArea.get(a.folder) ?? a.area;

  const groups = new Map<string, { sort: number; points: (LocationPoint & { sort: number })[] }>();
  for (const a of assets) {
    const placed = altars.find((p) => p.altar.asset === a.asset);
    const x = placed?.altar.xform ?? a.dest;
    const g = groups.get(a.area) ?? { sort: Infinity, points: [] };
    g.sort = Math.min(g.sort, a.sort);
    g.points.push({
      kind: a.kind,
      name: a.name,
      position: ueToThreePoint(x.t),
      forward: threeForward(x),
      placed: !!placed,
      level: placed?.level ?? null,
      sort: a.sort,
    });
    groups.set(a.area, g);
  }
  return [...groups]
    .sort((a, b) => a[1].sort - b[1].sort)
    .map(([area, g]) => ({
      area,
      points: g.points
        .sort((a, b) => (a.kind === b.kind ? a.sort - b.sort : a.kind === "fasttravel" ? -1 : 1))
        .map(({ sort: _s, ...p }) => p),
    }));
}

async function uiImage(path: string): Promise<UiImage | null> {
  try {
    const pkg = await loadPkg(path);
    if (!pkg) return null;
    const t = parseTexture2D(pkg, 4096);
    const m = t.mips[0];
    return { width: m.width, height: m.height, rgba: new Uint8Array(decodeToRGBA(t.format, m.data, m.width, m.height).buffer) };
  } catch {
    return null;
  }
}

async function rawFile(pakPath: string): Promise<Uint8Array | null> {
  return pak?.has(pakPath) ? (await pak.readFile(pakPath)).slice() : null;
}

const api: WorkerApi = {
  async open(file) {
    pak = await PakFile.open(new BlobSource(file));
    const ns = `${file.size}-${pak.entries.size}`;
    cache = await AssetCache.open(ns);
    await writeLastNamespace(ns);
    return ns;
  },

  async openUrl(url) {
    const src = await HttpRangeSource.open(url);
    pak = await PakFile.open(src);
    const ns = `${src.size}-${pak.entries.size}`;
    cache = await AssetCache.open(ns);
    await writeLastNamespace(ns);
    return ns;
  },

  async openCache(ns) {
    cache = await AssetCache.open(ns);
  },

  scene(levels) {
    return cached(`scene:${levels.join(",")}`, async () => {
      const persistent = await loadPkg(PERSISTENT);
      if (!persistent) throw new Error("Persistent level not found");
      const info = parsePersistentLevel(persistent);
      const actors: SceneActor[] = [];
      const loaded: string[] = [];
      const altars: { level: string; altar: PlacedAltar }[] = [];
      for (const name of levels) {
        const sl = info.levels.find((l) => l.name === name);
        const pkg = await loadPkg(sl?.packagePath ?? `/Game/RuinsLevel/Maps/${name}`);
        if (!pkg) continue;
        loaded.push(name);
        for (const p of parseLevelGeometry(pkg, sl?.xform)) {
          actors.push({ level: name, mesh: p.mesh, matrix: toThreeMatrix(p.xform), overrides: p.overrides });
        }
        for (const altar of parseLevelAltars(pkg, sl?.xform)) {
          altars.push({ level: name, altar });
          actors.push({ level: name, mesh: ALTAR_MESH[altar.kind], matrix: toThreeMatrix(altar.xform), overrides: [] });
        }
        pkgCache.delete(gamePathToPak(sl?.packagePath ?? `/Game/RuinsLevel/Maps/${name}`)); // levels are large
      }
      const spawn = info.spawn
        ? { position: ueToThreePoint(info.spawn.location), yaw: info.spawn.yaw }
        : null;
      const locations = await buildLocations(altars);
      return { levels: loaded, spawn, actors, locations } satisfies SceneData;
    });
  },

  geometry(path) {
    return cached(`mesh:${path}`, async () => {
      const pkg = await loadPkg(path);
      if (!pkg) throw new Error(`Mesh not found: ${path}`);
      const m = parseStaticMesh(pkg);
      pkgCache.delete(gamePathToPak(path));
      const n = m.positions.length / 3;
      const positions = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        positions[i * 3] = m.positions[i * 3] * UNIT;
        positions[i * 3 + 1] = m.positions[i * 3 + 2] * UNIT;
        positions[i * 3 + 2] = m.positions[i * 3 + 1] * UNIT;
      }
      // UE front faces are clockwise in a left-handed space. The Y/Z swap mirrors
      // them to counter-clockwise in right-handed three.js, so keep the order as is.
      const indices = m.indices;
      return { positions, uvs: m.uvs, indices, sections: m.sections, materials: m.materials } satisfies GeometryData;
    });
  },

  material(path) {
    return cached(`mat:${path}`, async () => (await resolveMaterial(path, loadPkg)) satisfies MaterialData);
  },

  uiAssets() {
    return cached("ui-assets", async () => ({
      fonts: {
        regular: await rawFile("QueensDomain/Content/UI/UI_Style/FontStyles/Rockwell_str_reg.ufont"),
        light: await rawFile("QueensDomain/Content/UI/UI_Style/FontStyles/Rockwell_std_light.ufont"),
      },
      images: {
        frame: await uiImage("/Game/UI/UI_Style/uibg"),
        panel: await uiImage("/Game/UI/UI_Style/UIbg_back"),
        dot: await uiImage("/Game/UI/UI_Style/EquippedDot"),
      },
    }) satisfies UiAssets);
  },

  texture(path) {
    return cached(`tex:${path}`, async () => {
      const pkg = await loadPkg(path);
      if (!pkg) throw new Error(`Texture not found: ${path}`);
      const t = parseTexture2D(pkg);
      pkgCache.delete(gamePathToPak(path));
      const mips = t.mips.map((m) => ({ width: m.width, height: m.height, data: m.data.slice() }));
      // WebGL needs the chain down to 1x1; block formats reuse the last 4x4 block.
      let last = mips[mips.length - 1];
      while (last.width > 1 || last.height > 1) {
        const w = Math.max(1, last.width >> 1), h = Math.max(1, last.height >> 1);
        if (w < 4 && h < 4 && /DXT|BC/.test(t.format)) {
          last = { width: w, height: h, data: last.data.slice(0, last.data.length) };
        } else break;
        mips.push(last);
      }
      return { format: t.format, srgb: t.srgb, isNormalMap: t.isNormalMap, mips } satisfies TextureData;
    });
  },
};

// Minimal RPC.
self.onmessage = async (ev: MessageEvent) => {
  const { id, method, args } = ev.data as { id: number; method: keyof WorkerApi; args: unknown[] };
  try {
    // deno-lint-ignore no-explicit-any
    const result = await (api[method] as any)(...args);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: (e as Error).message ?? String(e) });
  }
};
