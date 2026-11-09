/// <reference lib="webworker" />
import { AssetCache, pack, unpack, writeLastNamespace } from "./cache.ts";
import type {
  CollectiblePoint,
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
import {
  categorize,
  classResolver,
  LIBRARIAN_CLASS,
  SHOPKEEPER_CLASS,
  type PlacedCollectible,
  parseLevelCollectibles,
  SHELF_CLASS,
} from "./ue/collectibles.ts";
import { decodeToRGBA } from "./ue/decode.ts";
import { gamePathToPak, loadPackage } from "./ue/assets.ts";
import {
  classesNeedingTemplates,
  type ComponentTemplate,
  loadComponentTemplates,
  parseLevelAltars,
  parseLevelGeometry,
  parsePersistentLevel,
  type PlacedAltar,
} from "./ue/level.ts";
import { type LocationAsset, parseLocationAsset } from "./ue/locations.ts";
import { parseStringTable } from "./ue/stringtable.ts";
import { resolveMaterial } from "./ue/material.ts";
import type { Package } from "./ue/package.ts";
import { PakFile } from "./ue/pak.ts";
import { BlobSource, HttpRangeSource } from "./ue/source.ts";
import { parseSkeletalMesh, parseStaticMesh } from "./ue/staticmesh.ts";
import { parseTexture2D } from "./ue/texture.ts";
import { readProps } from "./ue/properties.ts";
import { IDENTITY, toThreeMatrix, ueToThreePoint, UNIT, type Xform } from "./ue/transform.ts";

/** Bump when parser output changes, to invalidate caches. */
const CACHE_VERSION = "v23";
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

/** Group Crystal Monuments / Wing Altars by area: the Wing Altar first, then monuments in game order. */
async function loadStrings(): Promise<Map<string, string>> {
  const stPkg = await loadPkg(STRING_TABLE);
  return stPkg ? parseStringTable(stPkg) : new Map<string, string>();
}

/** ItemIcon is an object import (or a soft path in some assets). */
function iconPath(pkg: Package, v: unknown): string | null {
  if (typeof v === "string") return v && v !== "None" ? v : null;
  const r = v && typeof v === "object" && "ref" in v ? (v as { ref: number }).ref : 0;
  return r < 0 ? pkg.importPath(r) : null;
}

/** Resolve item names, categories and icons for placed collectibles. */
async function buildCollectibles(placed: PlacedCollectible[], strings: Map<string, string>): Promise<CollectiblePoint[]> {
  const items = new Map<string, Promise<{ name: string; category: string | null; icon: string | null }>>();
  const itemData = (path: string) => {
    let p = items.get(path);
    if (!p) {
      p = (async () => {
        const pkg = await loadPkg(path).catch(() => null);
        const objName = path.split(".")[1];
        const e = pkg?.exports.find((x) => x.objectName === objName) ?? pkg?.exports[0];
        if (!pkg || !e) return { name: objName ?? path, category: null, icon: null };
        const p = readProps(pkg.exportReader(e), pkg);
        const n = p.Name as { key?: string; text?: string } | string | null;
        const name = typeof n === "string" ? n : n?.key ? strings.get(n.key) ?? n.key : n?.text ?? objName;
        return {
          name,
          category: typeof p.Category === "string" ? p.Category : null,
          icon: iconPath(pkg, p.ItemIcon),
        };
      })();
      items.set(path, p);
    }
    return p;
  };
  // Unique enemies: bestiary-counted types with one spawner in the world and no
  // boss health bar. The "A Lifetime's Work" bestiary needs one kill of each type.
  const spawners = new Map<string, number>();
  for (const c of placed) if (c.enemy) spawners.set(c.enemy, (spawners.get(c.enemy) ?? 0) + 1);
  const enemies = new Map<string, Promise<{ name: string; unique: boolean }>>();
  const enemyData = (path: string) => {
    let p = enemies.get(path);
    if (!p) {
      p = (async () => {
        const pkg = await loadPkg(path).catch(() => null);
        const e = pkg?.exports.find((x) => pkg.exportClass(x) === "EnemyData_C");
        if (!pkg || !e) return { name: path, unique: false };
        const p = readProps(pkg.exportReader(e), pkg);
        const n = p.Name as { key?: string } | null;
        const counted = p.DoNotCountForBestiaryTotal !== true && p.bDoNotAllowInBestiary !== true;
        return {
          name: n?.key ? strings.get(n.key) ?? n.key : path.split(".")[1],
          unique: counted && p.Boss !== true && spawners.get(path) === 1,
        };
      })();
      enemies.set(path, p);
    }
    return p;
  };
  // Book shelf slots in the Tower of Knowledge: book item -> the slot's save GUIDs.
  const shelf = new Map<string, string[]>();
  for (const c of placed) if (c.cls === SHELF_CLASS && c.item) shelf.set(c.item, c.guids);
  const out: CollectiblePoint[] = [];
  for (const c of placed) {
    const foe = c.enemy ? await enemyData(c.enemy) : null;
    if (foe && !foe.unique) continue;
    const data = c.item ? await itemData(c.item) : null;
    const name = foe
      ? foe.name
      : c.kind === "vault"
      ? "Treasure vault"
      : c.kind === "chest"
      ? "Chest"
      : c.kind === "door"
      ? "Secret door"
      : c.kind === "note"
      ? (c.title ? strings.get(c.title) ?? c.title : "Note")
      : data?.name ?? c.cls.split(".")[1];
    const category = categorize(c.cls, data?.category ?? null, c.kind);
    if (!category) continue;
    if (c.kind === "ghost") {
      // Companion spirits (other knights, raider sailors) inherit the memento class
      // setting; only the spirit named in "<Owner>'s Memento" gives it.
      const owner = /^(.+?)'s? Memento$/.exec(name)?.[1];
      const spirit = c.title ? strings.get(c.title) ?? c.title : "";
      if (!owner || !spirit.includes(owner)) continue;
    }
    out.push({
      id: `${c.level}/${c.actor}`,
      category,
      name,
      count: c.count,
      position: ueToThreePoint(c.xform.t),
      level: c.level,
      // Spawner GUIDs are in EnemySaveStates, not SavableActorStates; kills are tracked per type.
      guids: foe ? [] : category === "books" && c.item ? [...c.guids, ...(shelf.get(c.item) ?? [])] : c.guids,
      noteKey: c.noteKey,
      item: c.kind === "pickup" || c.kind === "ghost" ? c.item : null,
      hiddenBy: c.kind === "ghost"
        ? (c.title ? strings.get(c.title) ?? c.title : null)
        : c.kind === "vault"
        ? `opens with the ${data?.name ?? "Key Stone"}`
        : c.hiddenBy,
      icon: data?.icon ?? null,
      ...(c.activators.length ? { activators: c.activators, required: c.required } : {}),
      ...(c.enemy ? { enemy: c.enemy } : {}),
      ...(c.flag ? { flag: c.flag } : {}),
    });
  }
  // The Blood Key Stone is only sold in the Shop (Shop asset, key_sz_door_red: 24 Coins,
  // stock 1, after reading Treasure Hunter's Note III). Show it at the Shopkeeper.
  const bloodKey = "/Game/Items/KeyItems/ShopPurchasedKey/SZDoorKey_Red.SZDoorKey_Red";
  const shop = placed.find((c) => c.cls === SHOPKEEPER_CLASS);
  if (shop && !out.some((p) => p.item === bloodKey)) {
    const data = await itemData(bloodKey);
    const [x, y, z] = ueToThreePoint(shop.xform.t);
    out.push({
      id: `${shop.level}/${shop.actor}/bloodkey`,
      category: "keys",
      name: data.name,
      count: 1,
      position: [x, y + 2, z],
      level: shop.level,
      guids: [],
      noteKey: null,
      item: bloodKey,
      hiddenBy: "sold in the Shop for 24 Coins after reading Treasure Hunter's Note III",
      icon: data.icon,
    });
  }
  // Two books are not placed in the world: show them where they come from.
  const BOOKS = "/Game/Items/KeyItems/BookKeys/";
  const sources: { item: string; at: PlacedCollectible | undefined; hiddenBy: string; flag?: string }[] = [
    {
      item: `${BOOKS}Eldritch/BookKey_00_Eldritch_Item.BookKey_00_Eldritch_Item`,
      at: placed.find((c) => c.enemy?.includes("/LostLibrarian_Data.")),
      hiddenBy: `dropped by ${strings.get("lost_librarian_name") ?? "Bones of Archivist Inha"}`,
    },
    {
      item: `${BOOKS}Dragons/BookKey_00_Dragons_Item.BookKey_00_Dragons_Item`,
      at: placed.find((c) => c.cls === LIBRARIAN_CLASS),
      // Librarian_NPC_BP RewardList: the first reward, at 25% bestiary completion.
      hiddenBy: "Wourha's reward for 25% of the bestiary",
      flag: "LibrarianQuestRewardCount",
    },
  ];
  for (const s of sources) {
    if (!s.at || out.some((p) => p.item === s.item)) continue;
    const data = await itemData(s.item);
    // Lift it above the enemy / NPC marker at the same spot.
    const [x, y, z] = ueToThreePoint(s.at.xform.t);
    out.push({
      id: `${s.at.level}/${s.at.actor}/book`,
      category: "books",
      name: data.name,
      count: 1,
      position: [x, y + 1.5, z],
      level: s.at.level,
      guids: shelf.get(s.item) ?? [],
      noteKey: null,
      item: s.item,
      hiddenBy: s.hiddenBy,
      icon: data.icon,
      ...(s.flag ? { flag: s.flag } : {}),
    });
  }
  return out;
}

async function buildLocations(altars: { level: string; altar: PlacedAltar }[]): Promise<LocationGroup[]> {
  if (!pak) return [];
  const strings = await loadStrings();
  const assets: LocationAsset[] = [];
  for (const path of pak.entries.keys()) {
    const m = /^QueensDomain\/Content\/Blueprints\/Areas\/[^/]+\/([^/]+)\.uasset$/.exec(path);
    if (!m) continue;
    const pkg = await loadPkg("/Game/" + path.slice("QueensDomain/Content/".length).replace(/\.uasset$/, ""));
    const a = pkg && parseLocationAsset(pkg, strings);
    if (a) assets.push(a);
  }
  // Unnamed areas ("???") take the Wing Altar area name of the same folder.
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
      asset: a.asset,
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

async function uiImage(path: string, maxSize = 4096): Promise<UiImage | null> {
  try {
    const pkg = await loadPkg(path);
    if (!pkg) return null;
    const t = parseTexture2D(pkg, maxSize);
    const m = t.mips[0];
    return { width: m.width, height: m.height, rgba: new Uint8Array(decodeToRGBA(t.format, m.data, m.width, m.height).buffer) };
  } catch {
    return null;
  }
}

/** Box-filter an RGBA image down to at most `max` pixels on its long side. */
function downscale(img: UiImage, max: number): UiImage {
  const f = Math.ceil(Math.max(img.width, img.height) / max);
  if (f <= 1) return img;
  const w = Math.floor(img.width / f), h = Math.floor(img.height / f);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < f; dy++) {
          for (let dx = 0; dx < f; dx++) sum += img.rgba[((y * f + dy) * img.width + x * f + dx) * 4 + c];
        }
        out[(y * w + x) * 4 + c] = sum / (f * f);
      }
    }
  }
  return { width: w, height: h, rgba: out };
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
      const placed: PlacedCollectible[] = [];
      const classInfo = classResolver(loadPkg);
      const templateCache = new Map<string, Promise<Map<string, ComponentTemplate>>>();
      for (const name of levels) {
        const sl = info.levels.find((l) => l.name === name);
        const pkg = await loadPkg(sl?.packagePath ?? `/Game/RuinsLevel/Maps/${name}`);
        if (!pkg) continue;
        loaded.push(name);
        // Blueprint actors (e.g. vault door frames) keep their meshes in class templates.
        const templates = new Map<string, Map<string, ComponentTemplate>>();
        for (const cls of classesNeedingTemplates(pkg)) templates.set(cls, await loadComponentTemplates(cls, loadPkg, templateCache));
        for (const p of parseLevelGeometry(pkg, sl?.xform, (c) => templates.get(c))) {
          actors.push({
            level: name,
            mesh: p.mesh,
            matrix: toThreeMatrix(p.xform),
            overrides: p.overrides,
            ...(p.ghost ? { ghost: true } : {}),
          });
        }
        for (const altar of parseLevelAltars(pkg, sl?.xform)) {
          altars.push({ level: name, altar });
          actors.push({ level: name, mesh: ALTAR_MESH[altar.kind], matrix: toThreeMatrix(altar.xform), overrides: [] });
        }
        try {
          placed.push(...await parseLevelCollectibles(pkg, name, sl?.xform ?? IDENTITY, classInfo));
        } catch (e) {
          console.warn(`collectibles in ${name} failed`, e);
        }
        pkgCache.delete(gamePathToPak(sl?.packagePath ?? `/Game/RuinsLevel/Maps/${name}`)); // levels are large
      }
      const spawn = info.spawn
        ? { position: ueToThreePoint(info.spawn.location), yaw: info.spawn.yaw }
        : null;
      const locations = await buildLocations(altars);
      const collectibles = await buildCollectibles(placed, await loadStrings());
      return { levels: loaded, spawn, actors, locations, collectibles } satisfies SceneData;
    });
  },

  geometry(path) {
    return cached(`mesh:${path}`, async () => {
      const pkg = await loadPkg(path);
      if (!pkg) throw new Error(`Mesh not found: ${path}`);
      const m = pkg.exports.some((e) => pkg.exportClass(e) === "SkeletalMesh") ? parseSkeletalMesh(pkg) : parseStaticMesh(pkg);
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

  icon(path) {
    return cached(`icon:${path}`, async () => {
      const img = (await uiImage(path, 128)) ?? (await uiImage(path, 2048));
      return img && downscale(img, 128);
    });
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
