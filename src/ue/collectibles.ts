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
  | "coins"
  | "consumables"
  | "notes"
  | "chests";

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
  kind: "pickup" | "note" | "chest";
  /** What hides this pickup until it is activated (chest, crate, secret wall...). */
  hiddenBy: string | null;
  xform: Xform;
}

export interface ClassInfo {
  chain: string[];
  /** ItemsToGrant merged up the class chain. */
  grants: Map<string, number>;
  configOverride: string | null;
}

export const PICKUP_BASE = "/Game/Blueprints/CoreItemPickupActor.CoreItemPickupActor_C";
const NOTE_CLASS = /\/(Oldnotes_00_Inspect_BP|InspectText)\./;
const CHEST_CLASS = /Chest/;
/** Properties that list the actors an activator reveals. */
const ACTIVATOR_PROPS = ["ActorsToActivateOnOpen", "ActorsToActivateOnBreak", "ActivatableTargets"];

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
      const info: ClassInfo = { chain: [path], grants: new Map(), configOverride: null };
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
      }
      const cdo = pkg.exports.find((e) => e.objectName === "Default__" + clsName);
      if (cdo) {
        const props = readProps(pkg.exportReader(cdo), pkg);
        info.grants = applyGrants(info.grants, props.ItemsToGrant);
        const co = ref(props.PickupConfigOverride);
        if (co < 0) info.configOverride = pkg.importPath(co);
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
    const isActivator = /Chest|Crate|Barrel|pot|SecretWall/i.test(cls);
    const info = isNote ? null : await classInfo(cls);
    const isPickup = !!info?.chain.includes(PICKUP_BASE);
    if (!isNote && !isPickup && !isActivator) continue;
    const p = propsOf(i + 1);
    if (isActivator) {
      for (const name of ACTIVATOR_PROPS) {
        const list = p[name];
        if (!Array.isArray(list)) continue;
        for (const t of list) if (ref(t) > 0) hiddenBy.set(ref(t), hiderLabel(cls));
      }
    }
    if (!isNote && !isPickup && !isChest) continue;
    const root = ref(p.RootComponent);
    if (root <= 0) continue;
    const guids = Array.isArray(p.GUIDs)
      ? (p.GUIDs as unknown[]).filter((g): g is string => typeof g === "string")
      : typeof p.GUID === "string"
      ? [p.GUID]
      : [];
    let item: string | null = null;
    let count = 1;
    if (isPickup && info) {
      const grants = applyGrants(info.grants, p.ItemsToGrant);
      const first = [...grants][0];
      if (first) [item, count] = first;
      else item = info.configOverride;
    }
    const title = p.Title && typeof p.Title === "object" ? (p.Title as { key?: string; text?: string }) : null;
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
      kind: isNote ? "note" : isPickup ? "pickup" : "chest",
      hiddenBy: null,
      xform: worldOf(root),
    });
  }
  for (const c of out) {
    c.hiddenBy = hiddenBy.get(c.index) ?? (c.kind === "pickup" && propsOf(c.index).RequireActivation === true ? "hidden" : null);
  }
  return out.map(({ index: _i, ...c }) => c);
}

/** Map an item (class path + item data category enum) to a viewer category. */
export function categorize(cls: string, itemCategory: string | null, kind: PlacedCollectible["kind"]): CollectibleCategory {
  if (kind === "note") return "notes";
  if (kind === "chest") return "chests";
  const n = Number(/NewEnumerator(\d+)/.exec(itemCategory ?? "")?.[1] ?? -1);
  if (/\/KeyItems\/Egg\//.test(cls)) return "eggs";
  if (/\/SecretRelicKey\//.test(cls)) return "skulls";
  if (/\/Upgrades\/\w+_Upgrade\//.test(cls)) return "health";
  if (/\/(Upgrades|ScientistUpgrades)\/|RuneVisionUnlock|GrimoireInk/.test(cls)) return "upgrades";
  if (/\/Treasure\/Coins\//.test(cls)) return "coins";
  switch (n) {
    case 0:
      return "consumables";
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
