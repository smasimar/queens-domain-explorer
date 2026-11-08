import type { Package } from "./package.ts";
import { type MapValue, type ObjectRef, type Props, readProps, type Vec3 } from "./properties.ts";
import { compose, fromLocRotScale, type Xform } from "./transform.ts";

/** Viewer categories (one toggle each). */
export type CollectibleCategory =
  | "weapons"
  | "subweapons"
  | "accessories"
  | "eggs"
  | "skulls"
  | "keys"
  | "health"
  | "upgrades"
  | "treasure"
  | "notes"
  | "chests"
  | "doors"
  | "enemies"
  | "mementos"
  | "necklaces"
  | "modules";

/** One placed collectible, in UE world space. */
export interface PlacedCollectible {
  level: string;
  actor: string;
  cls: string;
  /** Item data asset path (first granted item), if any. */
  item: string | null;
  count: number;
  guids: string[];
  /** Notes: the key the save uses (`ReadNote_<key>`). */
  noteKey: string | null;
  /** Notes: the display title. */
  title: string | null;
  kind: "pickup" | "note" | "chest" | "door" | "enemy" | "ghost";
  /** Enemy spawners: the EnemyData asset path. */
  enemy: string | null;
  /**
   * Doors opened by levers, runes or switches save no state of their own: one GUID
   * list per activator, and how many activators must be in the save.
   */
  activators: string[][];
  required: number;
  /** What hides this pickup until it is activated (chest, crate, secret wall...). */
  hiddenBy: string | null;
  xform: Xform;
}

export interface ClassInfo {
  chain: string[];
  /** ItemsToGrant merged up the class chain. */
  grants: Map<string, number>;
  configOverride: string | null;
  /** EnemyData set on the class defaults (enemy spawners). */
  enemyData: string | null;
  /** Memento pickup class a ghost NPC gives (MementoBP). */
  memento: string | null;
}

export const PICKUP_BASE = "/Game/Blueprints/CoreItemPickupActor.CoreItemPickupActor_C";
const NOTE_CLASS = /\/(Oldnotes_00_Inspect_BP|InspectText)\./;
const CHEST_CLASS = /Chest/;
/** Spirits of NPCs; the ones with a MementoBP give a memento for the Okbujo shrine. */
const GHOST_BASE = "/Game/NPCs/NPC_Ghost_Base.NPC_Ghost_Base_C";
/** Every placed enemy comes from a subclass of this spawner. */
const SPAWNER_BASE = "/Game/Enemies/EnemySpawner.EnemySpawner_C";
/** Secret walls; the "Concealed Passages" challenge counts the ones without Don'tCountForAchievement. */
const DOOR_CLASS = "/Game/Blueprints/SecretWall.SecretWall_C";
/** Properties that list the actors an activator reveals. */
const ACTIVATOR_PROPS = ["ActorsToActivateOnOpen", "ActorsToActivateOnBreak", "ActivatableTargets"];

function guidsOf(p: Props): string[] {
  return Array.isArray(p.GUIDs)
    ? (p.GUIDs as unknown[]).filter((g): g is string => typeof g === "string")
    : typeof p.GUID === "string"
    ? [p.GUID]
    : [];
}

/** Export indices an actor's properties point at (any depth). */
function refsIn(v: unknown, out: Set<number>): Set<number> {
  if (Array.isArray(v)) for (const x of v) refsIn(x, out);
  else if (v && typeof v === "object") {
    if ("ref" in v) {
      const r = (v as ObjectRef).ref;
      if (r > 0) out.add(r);
    } else for (const x of Object.values(v)) refsIn(x, out);
  }
  return out;
}

function ref(v: unknown): number {
  return v && typeof v === "object" && "ref" in v ? (v as ObjectRef).ref : 0;
}

/** Apply a cooked Map<SoftObject,int> delta onto the parent's map. */
function applyGrants(base: Map<string, number>, v: unknown): Map<string, number> {
  const m = v as MapValue | null;
  if (!m || !Array.isArray(m.entries)) return base;
  const out = new Map(base);
  for (const k of m.removed) out.delete(String(k));
  for (const [k, n] of m.entries) out.set(String(k), Number(n));
  out.delete("None");
  return out;
}

/** Resolve a Blueprint class: its superclass chain and the items it grants. */
export function classResolver(loadPkg: (path: string) => Promise<Package | null>) {
  const cache = new Map<string, Promise<ClassInfo>>();
  const resolve = (path: string): Promise<ClassInfo> => {
    let p = cache.get(path);
    if (p) return p;
    p = (async () => {
      const info: ClassInfo = { chain: [path], grants: new Map(), configOverride: null, enemyData: null, memento: null };
      if (!path.startsWith("/Game/")) return info;
      const pkg = await loadPkg(path).catch(() => null);
      if (!pkg) return info;
      const clsName = path.split(".")[1];
      const ci = pkg.exports.findIndex((e) => e.objectName === clsName);
      if (ci < 0) return info;
      const cls = pkg.exports[ci];
      if (cls.superIndex < 0) {
        const sup = await resolve(pkg.importPath(cls.superIndex));
        info.chain.push(...sup.chain);
        info.grants = new Map(sup.grants);
        info.configOverride = sup.configOverride;
        info.enemyData = sup.enemyData;
        info.memento = sup.memento;
      }
      const cdo = pkg.exports.find((e) => e.objectName === "Default__" + clsName);
      if (cdo) {
        const props = readProps(pkg.exportReader(cdo), pkg);
        info.grants = applyGrants(info.grants, props.ItemsToGrant);
        const co = ref(props.PickupConfigOverride);
        if (co < 0) info.configOverride = pkg.importPath(co);
        const ed = ref(props.EnemyData);
        if (ed < 0) info.enemyData = pkg.importPath(ed);
        if (typeof props.MementoBP === "string" && props.MementoBP !== "None") info.memento = props.MementoBP;
        const mb = ref(props.MementoBP);
        if (mb < 0) info.memento = pkg.importPath(mb);
      }
      return info;
    })();
    cache.set(path, p);
    return p;
  };
  return resolve;
}

function hiderLabel(cls: string): string {
  if (/Chest/i.test(cls)) return "in chest";
  if (/Crate/i.test(cls)) return "in crate";
  if (/Barrel/i.test(cls)) return "in barrel";
  if (/pot/i.test(cls)) return "in pot";
  if (/SecretWall/i.test(cls)) return "behind secret wall";
  return "hidden";
}

/** Find pickups, lore notes and chests placed in one sublevel. */
export async function parseLevelCollectibles(
  pkg: Package,
  level: string,
  levelXform: Xform,
  classInfo: (path: string) => Promise<ClassInfo>,
): Promise<PlacedCollectible[]> {
  const propCache = new Map<number, Props>();
  const propsOf = (i: number): Props => {
    let p = propCache.get(i);
    if (!p) {
      try {
        p = readProps(pkg.exportReader(pkg.exports[i - 1]), pkg);
      } catch {
        p = {};
      }
      propCache.set(i, p);
    }
    return p;
  };
  const worldOf = (i: number, depth = 0): Xform => {
    const p = propsOf(i);
    const local = fromLocRotScale(p.RelativeLocation as Vec3, p.RelativeRotation as Vec3, p.RelativeScale3D as Vec3);
    const parent = ref(p.AttachParent);
    return parent > 0 && depth < 32 ? compose(worldOf(parent, depth + 1), local) : compose(levelXform, local);
  };

  const out: (PlacedCollectible & { index: number })[] = [];
  const hiddenBy = new Map<number, string>();
  for (let i = 0; i < pkg.exports.length; i++) {
    const e = pkg.exports[i];
    const outer = pkg.exports[e.outerIndex - 1];
    if (!outer || pkg.exportClass(outer) !== "Level" || e.classIndex >= 0) continue;
    const cls = pkg.importPath(e.classIndex);
    if (!cls.startsWith("/Game/")) continue;
    const isNote = NOTE_CLASS.test(cls);
    const isChest = CHEST_CLASS.test(cls);
    const isDoor = cls === DOOR_CLASS;
    const isActivator = /Chest|Crate|Barrel|pot|SecretWall/i.test(cls);
    const info = isNote ? null : await classInfo(cls);
    const isPickup = !!info?.chain.includes(PICKUP_BASE);
    const isSpawner = !!info?.chain.includes(SPAWNER_BASE);
    const isGhost = !!info?.memento && info.chain.includes(GHOST_BASE);
    if (!isNote && !isPickup && !isActivator && !isSpawner && !isGhost) continue;
    const p = propsOf(i + 1);
    if (isActivator) {
      for (const name of ACTIVATOR_PROPS) {
        const list = p[name];
        if (!Array.isArray(list)) continue;
        for (const t of list) if (ref(t) > 0) hiddenBy.set(ref(t), hiderLabel(cls));
      }
    }
    if (isDoor && p["Don'tCountForAchievement"] === true) continue;
    let enemy: string | null = null;
    if (isSpawner) {
      const ed = ref(p.EnemyData);
      enemy = ed < 0 ? pkg.importPath(ed) : info?.enemyData ?? null;
      if (!enemy) continue;
    }
    if (!isNote && !isPickup && !isChest && !isDoor && !isSpawner && !isGhost) continue;
    const root = ref(p.RootComponent);
    if (root <= 0) continue;
    const guids = guidsOf(p);
    let item: string | null = null;
    let count = 1;
    if (isPickup && info) {
      const grants = applyGrants(info.grants, p.ItemsToGrant);
      const first = [...grants][0];
      if (first) [item, count] = first;
      else item = info.configOverride;
    }
    if (isGhost && info?.memento) {
      // The memento is the first item its pickup class grants.
      const first = [...(await classInfo(info.memento)).grants][0];
      if (first) item = first[0];
    }
    // Ghosts: their display name ("Spirit of Peha"); notes: their title.
    const t = isGhost ? p.name ?? p.Name : p.Title;
    const title = t && typeof t === "object" ? (t as { key?: string; text?: string }) : null;
    out.push({
      index: i + 1,
      level,
      actor: e.objectName,
      cls,
      item,
      count,
      guids,
      noteKey: typeof p.ImportKey === "string" && p.ImportKey ? p.ImportKey : null,
      title: title ? title.key ?? title.text ?? null : null,
      kind: isNote ? "note" : isPickup ? "pickup" : isDoor ? "door" : isSpawner ? "enemy" : isGhost ? "ghost" : "chest",
      enemy,
      hiddenBy: null,
      activators: [],
      required: isDoor && typeof p.ActivationCountRequirement === "number" ? p.ActivationCountRequirement : 1,
      xform: worldOf(root),
    });
  }
  // Doors in ActivatableMode open from other actors (levers, runes, switches,
  // other walls) and only those actors save their state.
  const switched = new Map(out.filter((c) => c.kind === "door" && propsOf(c.index).ActivatableMode === true).map((c) => [c.index, c]));
  if (switched.size) {
    for (let i = 0; i < pkg.exports.length; i++) {
      const e = pkg.exports[i];
      const outer = pkg.exports[e.outerIndex - 1];
      if (!outer || pkg.exportClass(outer) !== "Level" || e.classIndex >= 0 || switched.has(i + 1)) continue;
      if (!pkg.importPath(e.classIndex).startsWith("/Game/")) continue;
      const p = propsOf(i + 1);
      const g = guidsOf(p);
      if (!g.length) continue;
      for (const r of refsIn(p, new Set())) switched.get(r)?.activators.push(g);
    }
  }
  for (const c of out) {
    if (c.kind === "enemy") continue;
    if (c.kind === "door") {
      c.hiddenBy = c.activators.length ? (c.required > 1 ? `opens with ${c.required} switches` : "opens with a switch") : null;
      continue;
    }
    c.hiddenBy = hiddenBy.get(c.index) ?? (c.kind === "pickup" && propsOf(c.index).RequireActivation === true ? "hidden" : null);
  }
  return out.map(({ index: _i, ...c }) => c);
}

/**
 * Map an item (class path + item data category enum) to a viewer category.
 * Null for coins and consumables, which the viewer does not show.
 */
export function categorize(
  cls: string,
  itemCategory: string | null,
  kind: PlacedCollectible["kind"],
): CollectibleCategory | null {
  if (kind === "note") return "notes";
  if (kind === "chest") return "chests";
  if (kind === "door") return "doors";
  if (kind === "enemy") return "enemies";
  if (kind === "ghost") return "mementos";
  if (/\/RaiderNecklaceKey\//.test(cls)) return "necklaces";
  if (/\/ScientistUpgrades\/WeaponUpgradeUnlock/.test(cls)) return "modules";
  const n = Number(/NewEnumerator(\d+)/.exec(itemCategory ?? "")?.[1] ?? -1);
  if (/\/KeyItems\/Egg\//.test(cls)) return "eggs";
  if (/\/SecretRelicKey\//.test(cls)) return "skulls";
  if (/\/Upgrades\/\w+_Upgrade\//.test(cls)) return "health";
  if (/\/(Upgrades|ScientistUpgrades)\/|RuneVisionUnlock|GrimoireInk/.test(cls)) return "upgrades";
  if (/\/Treasure\/Coins\//.test(cls)) return null;
  switch (n) {
    case 0:
      return null;
    case 1:
      return "accessories";
    case 2:
      return "weapons";
    case 3:
      return "subweapons";
    case 5:
      return "keys";
    case 7:
      return "treasure";
  }
  return "treasure";
}
