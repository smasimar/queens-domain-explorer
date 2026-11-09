import type { Package } from "./package.ts";
import { readProps, type ObjectRef, type Props, type Vec3 } from "./properties.ts";
import { compose, fromLocRotScale, fromQuat, IDENTITY, type Xform } from "./transform.ts";

/** One placed static mesh in UE world space. */
export interface PlacedMesh {
  mesh: string; // object path, e.g. /Game/RuinsLevel/Models/X.X
  xform: Xform;
  /** Per-slot material overrides (null = mesh default). */
  overrides: (string | null)[];
  /** Draw see-through: secret walls and vault doors, so the passage behind shows. */
  ghost?: boolean;
}

/** Secret walls and vault doors (not their frames) are drawn see-through. */
const GHOST_ACTOR = /^(SecretWall_C$|SecretZoneDoor_|SZ_Door_)/;
const isGhost = (actorClass: string, component: string) => GHOST_ACTOR.test(actorClass) && !/Frame/i.test(component);

/**
 * Actor classes that are never level geometry: post-process/visibility helpers,
 * pickups, props, foliage, enemies and NPCs. Everything else with a level-set
 * StaticMesh counts (e.g. StaticMeshActor, FS_OW_Tower_BP_C).
 */
const ACTOR_EXCLUDE =
  /^(PPC_|FS_EnemyPPC|Pot_|or_pot|gd_|Deco_|Ros_Small_Prop|Ivy_|FS_(Grass|Fern|Bush|Branch|Moss)|Tree_|FallenLeaves|Leaf|Chest|Crate|Barrel|Candle|Brazier|FloorBrazier|WallSconce|ShopTreasure|Shackle)|Pickup|Item|Spawner|NPC|Pedestal|Relic|Looker|Bird|Bug|Fish|Fog|Cloud|LightBeam|Hint|Decoy/i;
const MESH_INCLUDE = /^\/Game\/(RuinsLevel|OtherWorld)\//;
const MESH_EXCLUDE =
  /\/(NPCs|Enemies|Items|Plantsa?|Foliage)\/|AudioOcclusion|_Collision|Blocker|_PPC|PPC_|_EW$|_EW\.|HINT|collider|FogCard|Sky_|_Sky|\/Sky\/|ShadowBox|ShadowDoer|\.Cube$/i;

export function isLevelGeometryMesh(path: string): boolean {
  return MESH_INCLUDE.test(path) && !MESH_EXCLUDE.test(path);
}

export function isGeometryActor(cls: string): boolean {
  return !ACTOR_EXCLUDE.test(cls);
}

function ref(v: unknown): number {
  return v && typeof v === "object" && "ref" in v ? (v as ObjectRef).ref : 0;
}

/** A placed Crystal Monument (Checkpoint_C) or Wing Altar (Teleporter_C). */
export interface PlacedAltar {
  kind: "fasttravel" | "save";
  /** LocationData asset path, e.g. /Game/Blueprints/Areas/1GreenRuins/GR_Camp_Save.GR_Camp_Save */
  asset: string | null;
  xform: Xform;
}

/**
 * A Blueprint component's defaults (its construction-script template, with the
 * overrides of child Blueprints applied). Level instances of Blueprint actors only
 * store what differs from these, so a door's frame mesh and offset live here.
 */
export interface ComponentTemplate {
  /** Static mesh object path. */
  mesh?: string;
  overrides?: (string | null)[];
  loc?: Vec3;
  rot?: Vec3;
  scale?: Vec3;
  hidden?: boolean;
}

/** Component templates of an actor class, by component name; undefined if none. */
export type TemplateLookup = (actorClass: string) => Map<string, ComponentTemplate> | undefined;

const isBlueprintClass = (path: string) => path.startsWith("/Game/");

/**
 * Blueprint actors whose meshes come only from the class (not set in the level) are
 * drawn only when they shape where the player can go: doors, gates, grates, secret
 * walls, vault rooms and frames, lifts, bridges, platforms and locks. Props (graves,
 * tables, lamps, plants), levers, switches, key slots and the Wing Altar's preview
 * dome are left out.
 */
const TEMPLATE_ALLOW = /Door|Gate|Grate|SecretWall|^SR_|^SZFrame_|WebBossWall|Lift|Elevator|Bridge|Platform|Lock|ScienceRoom/i;
const TEMPLATE_DENY = /Lamp|Light|Sconce|Torch|Lever|Switch|Recepticle|Teleporter/i;
const templateActor = (cls: string) => TEMPLATE_ALLOW.test(cls) && !TEMPLATE_DENY.test(cls);

/** Blueprint actor classes in a level that own a StaticMeshComponent with no mesh set on the instance. */
export function classesNeedingTemplates(pkg: Package): Set<string> {
  const out = new Set<string>();
  for (const e of pkg.exports) {
    const c = pkg.exportClass(e);
    if (c !== "StaticMeshComponent" && c !== "SkeletalMeshComponent") continue;
    const outer = pkg.exports[e.outerIndex - 1];
    if (!outer || outer.classIndex >= 0) continue;
    const cls = pkg.importPath(outer.classIndex);
    const name = pkg.exportClass(outer);
    if (isBlueprintClass(cls) && isGeometryActor(name) && templateActor(name)) out.add(cls);
  }
  return out;
}

/** Read a Blueprint class's component templates, merged down its Blueprint superclasses. */
export function loadComponentTemplates(
  classPath: string,
  loadPkg: (path: string) => Promise<Package | null>,
  cache: Map<string, Promise<Map<string, ComponentTemplate>>>,
): Promise<Map<string, ComponentTemplate>> {
  let p = cache.get(classPath);
  if (p) return p;
  p = (async () => {
    const out = new Map<string, ComponentTemplate>();
    if (!isBlueprintClass(classPath)) return out;
    const pkg = await loadPkg(classPath).catch(() => null);
    if (!pkg) return out;
    const cls = pkg.exports.find((e) => e.objectName === classPath.split(".")[1]);
    if (cls && cls.superIndex < 0) {
      for (const [k, v] of await loadComponentTemplates(pkg.importPath(cls.superIndex), loadPkg, cache)) out.set(k, { ...v });
    }
    for (const e of pkg.exports) {
      // Construction-script templates ("<name>_GEN_VARIABLE") and components of the
      // class defaults object (e.g. "StaticMeshComponent0" under "Default__X_C").
      const outer = pkg.exports[e.outerIndex - 1];
      if (!e.objectName.endsWith("_GEN_VARIABLE") && !outer?.objectName.startsWith("Default__")) continue;
      let pr: Props;
      try {
        pr = readProps(pkg.exportReader(e), pkg);
      } catch {
        continue;
      }
      // "ICH-<name>_GEN_VARIABLE" overrides a component inherited from a parent class.
      const name = e.objectName.replace(/^ICH-/, "").replace(/_GEN_VARIABLE$/, "");
      const t: ComponentTemplate = { ...out.get(name) };
      const sm = ref(pr.StaticMesh) || ref(pr.SkeletalMesh);
      if (sm < 0) t.mesh = pkg.importPath(sm);
      if (Array.isArray(pr.OverrideMaterials)) {
        t.overrides = (pr.OverrideMaterials as ObjectRef[]).map((m) => (ref(m) < 0 ? pkg.importPath(ref(m)) : null));
      }
      if (pr.RelativeLocation) t.loc = pr.RelativeLocation as Vec3;
      if (pr.RelativeRotation) t.rot = pr.RelativeRotation as Vec3;
      if (pr.RelativeScale3D) t.scale = pr.RelativeScale3D as Vec3;
      if (pr.bVisible === false || pr.bHiddenInGame === true) t.hidden = true;
      out.set(name, t);
    }
    return out;
  })();
  cache.set(classPath, p);
  return p;
}

/** Resolves component props and world transforms (following AttachParent) within one package. */
function transformResolver(pkg: Package, levelXform: Xform, templates?: TemplateLookup) {
  const propCache = new Map<number, Props>();
  /** The component's Blueprint template, if its actor is a Blueprint instance. */
  const templateOf = (exportIndex: number): ComponentTemplate | undefined => {
    if (!templates) return undefined;
    const e = pkg.exports[exportIndex - 1];
    const outer = pkg.exports[e.outerIndex - 1];
    if (!outer || outer.classIndex >= 0) return undefined;
    return templates(pkg.importPath(outer.classIndex))?.get(e.objectName);
  };
  const propsOf = (exportIndex: number): Props => {
    let p = propCache.get(exportIndex);
    if (!p) {
      try {
        p = readProps(pkg.exportReader(pkg.exports[exportIndex - 1]), pkg);
      } catch {
        p = {};
      }
      const t = templateOf(exportIndex);
      if (t) {
        if (p.RelativeLocation === undefined && t.loc) p.RelativeLocation = t.loc;
        if (p.RelativeRotation === undefined && t.rot) p.RelativeRotation = t.rot;
        if (p.RelativeScale3D === undefined && t.scale) p.RelativeScale3D = t.scale;
      }
      propCache.set(exportIndex, p);
    }
    return p;
  };
  const worldOf = (exportIndex: number, depth = 0): Xform => {
    const p = propsOf(exportIndex);
    const local = fromLocRotScale(p.RelativeLocation as Vec3, p.RelativeRotation as Vec3, p.RelativeScale3D as Vec3);
    const parent = ref(p.AttachParent);
    if (parent > 0 && depth < 32) return compose(worldOf(parent, depth + 1), local);
    return compose(levelXform, local);
  };
  return { propsOf, worldOf, templateOf };
}

/** Extract level-geometry static meshes from a sublevel package. */
export function parseLevelGeometry(pkg: Package, levelXform: Xform = IDENTITY, templates?: TemplateLookup): PlacedMesh[] {
  const { propsOf, worldOf, templateOf } = transformResolver(pkg, levelXform, templates);
  const out: PlacedMesh[] = [];
  pkg.exports.forEach((e, i) => {
    const compClass = pkg.exportClass(e);
    // Skeletal meshes only from Blueprint templates of see-through doors (vault door leaves).
    if (compClass !== "StaticMeshComponent" && compClass !== "SkeletalMeshComponent") return;
    const outerIdx = e.outerIndex;
    const outer = pkg.exports[outerIdx - 1];
    if (!outer || !isGeometryActor(pkg.exportClass(outer))) return;
    const idx = i + 1;
    const p = propsOf(idx);
    const smRef = ref(compClass === "StaticMeshComponent" ? p.StaticMesh : p.SkeletalMesh);
    const t = templateOf(idx);
    const set = compClass === "StaticMeshComponent" ? p.StaticMesh : p.SkeletalMesh;
    const mesh = smRef < 0
      ? pkg.importPath(smRef)
      : set === undefined && templateActor(pkg.exportClass(outer))
      ? t?.mesh
      : undefined;
    if (compClass === "SkeletalMeshComponent" && !isGhost(pkg.exportClass(outer), e.objectName)) return;
    if (!mesh || !isLevelGeometryMesh(mesh)) return;
    if (p.bVisible === false || p.bHiddenInGame === true) return;
    if (t?.hidden && p.bVisible === undefined && p.bHiddenInGame === undefined) return;
    const actor = propsOf(outerIdx);
    if (actor.bHidden === true) return;
    const overrides = Array.isArray(p.OverrideMaterials)
      ? (p.OverrideMaterials as ObjectRef[]).map((m) => (ref(m) < 0 ? pkg.importPath(ref(m)) : null))
      : t?.overrides ?? [];
    const ghost = isGhost(pkg.exportClass(outer), e.objectName);
    out.push({ mesh, xform: worldOf(idx), overrides, ...(ghost ? { ghost } : {}) });
  });
  return out;
}

/** Find Crystal Monument and Wing Altar actors in a sublevel. */
export function parseLevelAltars(pkg: Package, levelXform: Xform = IDENTITY): PlacedAltar[] {
  const { propsOf, worldOf } = transformResolver(pkg, levelXform);
  const out: PlacedAltar[] = [];
  pkg.exports.forEach((e, i) => {
    const cls = pkg.exportClass(e);
    const kind = cls === "Teleporter_C" ? "fasttravel" : cls === "Checkpoint_C" ? "save" : null;
    if (!kind) return;
    const p = propsOf(i + 1);
    const root = ref(p.RootComponent);
    if (root <= 0) return;
    const loc = ref(p.LocationData);
    out.push({ kind, asset: loc < 0 ? pkg.importPath(loc) : null, xform: worldOf(root) });
  });
  return out;
}

export interface StreamingLevel {
  /** Package name, e.g. "100_GR". */
  name: string;
  packagePath: string; // "/Game/RuinsLevel/Maps/100_GR"
  xform: Xform;
}

export interface PersistentInfo {
  spawn: { location: Vec3; yaw: number } | null;
  levels: StreamingLevel[];
}

/** Read PlayerStart and streaming sublevels from the persistent level. */
export function parsePersistentLevel(pkg: Package): PersistentInfo {
  const levels: StreamingLevel[] = [];
  let spawn: PersistentInfo["spawn"] = null;
  pkg.exports.forEach((e, i) => {
    const cls = pkg.exportClass(e);
    if (cls.startsWith("LevelStreaming")) {
      const p = readProps(pkg.exportReader(e), pkg);
      const world = typeof p.WorldAsset === "string" ? p.WorldAsset : null;
      if (!world) return;
      const packagePath = world.split(".")[0];
      const t = (p.LevelTransform ?? {}) as Props;
      levels.push({
        name: packagePath.split("/").pop()!,
        packagePath,
        xform: fromQuat(t.Rotation as never, t.Translation as Vec3, t.Scale3D as Vec3),
      });
    } else if (cls === "PlayerStart" && !spawn) {
      const actorIdx = i + 1;
      for (const c of pkg.exports) {
        if (c.outerIndex !== actorIdx) continue;
        const p = readProps(pkg.exportReader(c), pkg);
        if (p.RelativeLocation) {
          const rot = (p.RelativeRotation as Vec3) ?? [0, 0, 0];
          spawn = { location: p.RelativeLocation as Vec3, yaw: rot[1] };
          break;
        }
      }
    }
  });
  return { spawn, levels };
}
