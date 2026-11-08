import type { Package } from "./package.ts";
import { readProps, type ObjectRef, type Props, type Vec3 } from "./properties.ts";
import { compose, fromLocRotScale, fromQuat, IDENTITY, type Xform } from "./transform.ts";

/** One placed static mesh in UE world space. */
export interface PlacedMesh {
  mesh: string; // object path, e.g. /Game/RuinsLevel/Models/X.X
  xform: Xform;
  /** Per-slot material overrides (null = mesh default). */
  overrides: (string | null)[];
}

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

/** Resolves component props and world transforms (following AttachParent) within one package. */
function transformResolver(pkg: Package, levelXform: Xform) {
  const propCache = new Map<number, Props>();
  const propsOf = (exportIndex: number): Props => {
    let p = propCache.get(exportIndex);
    if (!p) {
      try {
        p = readProps(pkg.exportReader(pkg.exports[exportIndex - 1]), pkg);
      } catch {
        p = {};
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
  return { propsOf, worldOf };
}

/** Extract level-geometry static meshes from a sublevel package. */
export function parseLevelGeometry(pkg: Package, levelXform: Xform = IDENTITY): PlacedMesh[] {
  const { propsOf, worldOf } = transformResolver(pkg, levelXform);
  const out: PlacedMesh[] = [];
  pkg.exports.forEach((e, i) => {
    if (pkg.exportClass(e) !== "StaticMeshComponent") return;
    const outerIdx = e.outerIndex;
    const outer = pkg.exports[outerIdx - 1];
    if (!outer || !isGeometryActor(pkg.exportClass(outer))) return;
    const idx = i + 1;
    const p = propsOf(idx);
    const smRef = ref(p.StaticMesh);
    if (smRef >= 0) return;
    const mesh = pkg.importPath(smRef);
    if (!isLevelGeometryMesh(mesh)) return;
    if (p.bVisible === false || p.bHiddenInGame === true) return;
    const actor = propsOf(outerIdx);
    if (actor.bHidden === true) return;
    const overrides = Array.isArray(p.OverrideMaterials)
      ? (p.OverrideMaterials as ObjectRef[]).map((m) => (ref(m) < 0 ? pkg.importPath(ref(m)) : null))
      : [];
    out.push({ mesh, xform: worldOf(idx), overrides });
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
