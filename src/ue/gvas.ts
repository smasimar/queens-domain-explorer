import { Reader } from "./reader.ts";

/**
 * UE4 SaveGame (GVAS) reader. Tagged properties with inline names and full type info.
 * Values that are not understood are skipped by their tag size.
 */
export type SaveValue = unknown;

interface Tag {
  name: string;
  type: string;
  size: number;
  struct: string;
  inner: string;
  value: string;
  bool: boolean;
}

const NATIVE: Record<string, (r: Reader) => SaveValue> = {
  Vector: (r) => [r.f32(), r.f32(), r.f32()],
  Rotator: (r) => [r.f32(), r.f32(), r.f32()],
  Vector2D: (r) => [r.f32(), r.f32()],
  Quat: (r) => [r.f32(), r.f32(), r.f32(), r.f32()],
  LinearColor: (r) => [r.f32(), r.f32(), r.f32(), r.f32()],
  Color: (r) => [r.u8(), r.u8(), r.u8(), r.u8()],
  IntPoint: (r) => [r.i32(), r.i32()],
  Guid: (r) => r.guid(),
  // .NET ticks (100 ns since 0001-01-01) -> ISO string
  DateTime: (r) => new Date(Number((r.u64big() - 621355968000000000n) / 10000n)).toISOString(),
  Timespan: (r) => r.i64(),
};

function readTag(r: Reader): Tag | null {
  const name = r.fstring();
  if (name === "None" || name === "") return null;
  const t: Tag = { name, type: r.fstring(), size: r.i32(), struct: "", inner: "", value: "", bool: false };
  r.i32(); // array index
  switch (t.type) {
    case "StructProperty":
      t.struct = r.fstring();
      r.guid();
      break;
    case "BoolProperty":
      t.bool = r.u8() !== 0;
      break;
    case "ByteProperty":
    case "EnumProperty":
    case "ArrayProperty":
    case "SetProperty":
      t.inner = r.fstring();
      break;
    case "MapProperty":
      t.inner = r.fstring();
      t.value = r.fstring();
      break;
  }
  if (r.u8()) r.guid();
  return t;
}

function readProps(r: Reader): Record<string, SaveValue> {
  const out: Record<string, SaveValue> = {};
  for (;;) {
    const t = readTag(r);
    if (!t) break;
    if (t.type === "BoolProperty") {
      out[t.name] = t.bool;
      continue;
    }
    const start = r.pos;
    try {
      out[t.name] = readValue(r, t);
    } catch {
      out[t.name] = undefined;
    }
    r.pos = start + t.size;
  }
  return out;
}

function readStruct(r: Reader, name: string): SaveValue {
  const n = NATIVE[name];
  return n ? n(r) : readProps(r);
}

function readText(r: Reader): SaveValue {
  r.u32();
  const h = r.i8();
  if (h === -1) return r.bool32() ? r.fstring() : "";
  if (h === 0) return { ns: r.fstring(), key: r.fstring(), text: r.fstring() };
  if (h === 11) return { table: r.fstring(), key: r.fstring() };
  throw new Error(`text history ${h}`);
}

function readElem(r: Reader, type: string, struct = ""): SaveValue {
  switch (type) {
    case "IntProperty":
      return r.i32();
    case "Int64Property":
      return r.i64();
    case "UInt32Property":
      return r.u32();
    case "FloatProperty":
      return r.f32();
    case "BoolProperty":
    case "ByteProperty":
      return r.u8();
    case "EnumProperty":
    case "NameProperty":
    case "StrProperty":
    case "ObjectProperty":
    case "ClassProperty":
      return r.fstring();
    case "SoftObjectProperty":
    case "SoftClassProperty": {
      const v = r.fstring();
      r.fstring();
      return v;
    }
    case "TextProperty":
      return readText(r);
    case "StructProperty":
      return readStruct(r, struct);
    default:
      throw new Error(`element type ${type}`);
  }
}

function readValue(r: Reader, t: Tag): SaveValue {
  switch (t.type) {
    case "ByteProperty":
      return t.inner === "None" ? r.u8() : r.fstring();
    case "StructProperty":
      return readStruct(r, t.struct);
    case "ArrayProperty": {
      const n = r.i32();
      if (t.inner === "StructProperty") {
        const et = readTag(r)!;
        return Array.from({ length: n }, () => readStruct(r, et.struct));
      }
      return Array.from({ length: n }, () => readElem(r, t.inner));
    }
    case "SetProperty": {
      r.i32(); // removed
      const n = r.i32();
      // Struct elements carry no type info; Guid is the common case.
      return Array.from({ length: n }, () => (t.inner === "StructProperty" ? r.guid() : readElem(r, t.inner)));
    }
    case "MapProperty": {
      r.i32(); // removed
      const n = r.i32();
      const out: [SaveValue, SaveValue][] = [];
      for (let i = 0; i < n; i++) {
        // Struct keys carry no type info (Guid here); struct values are tagged properties.
        const k = t.inner === "StructProperty" ? r.guid() : readElem(r, t.inner);
        const v = t.value === "StructProperty" ? readProps(r) : readElem(r, t.value);
        out.push([k, v]);
      }
      return out;
    }
    default:
      return readElem(r, t.type, t.struct);
  }
}

export interface GvasFile {
  saveClass: string;
  props: Record<string, SaveValue>;
}

export function readGvas(bytes: Uint8Array): GvasFile {
  const r = new Reader(bytes);
  if (String.fromCharCode(...r.take(4)) !== "GVAS") throw new Error("Not a UE save file (no GVAS header)");
  r.i32(); // save game version
  r.i32(); // package version
  r.skip(6 + 4); // engine major/minor/patch, changelist
  r.fstring(); // branch
  r.i32(); // custom version format
  r.array(() => r.skip(20));
  const saveClass = r.fstring();
  return { saveClass, props: readProps(r) };
}

/** The parts of a Queen's Domain progress save that the viewer uses. */
export interface SaveProgress {
  lastSaveTime: string | null;
  playTimeSeconds: number | null;
  /** GUIDs of collected/opened savable actors. */
  actorStates: string[];
  /** NamedSaveData keys, e.g. "ReadNote_gr_mghint". */
  flags: string[];
  unlockedTeleporters: string[];
  savePointsVisited: string[];
  /**
   * Item data paths the player has had: inventory (count 0 once used up or sold),
   * shop sales, equipment and weapon levels.
   */
  itemsOwned: string[];
}

const strings = (v: SaveValue) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const mapKeys = (v: SaveValue) => (Array.isArray(v) ? v.map((e) => (e as [SaveValue, SaveValue])[0]) : []);

export function readSaveProgress(bytes: Uint8Array): SaveProgress {
  const { saveClass, props: p } = readGvas(bytes);
  if (!/FS_SaveSlot/.test(saveClass)) throw new Error(`Not a progress save (${saveClass})`);
  return {
    lastSaveTime: typeof p.LastSaveTime === "string" ? p.LastSaveTime : null,
    playTimeSeconds: typeof p.PlayTime_Seconds === "number" ? p.PlayTime_Seconds : null,
    actorStates: strings(mapKeys(p.SavableActorStates)),
    flags: strings(mapKeys(p.NamedSaveData)),
    unlockedTeleporters: strings(p.UnlockedTeleporters),
    savePointsVisited: strings(p.SavePointsVisited),
    itemsOwned: strings([
      ...mapKeys(p.InventoryContents),
      ...mapKeys(p.ShopSales),
      ...mapKeys(p.Equipment),
      ...mapKeys(p.WeaponLevels),
    ]),
  };
}
