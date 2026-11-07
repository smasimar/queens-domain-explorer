import type { Package } from "./package.ts";
import { Reader } from "./reader.ts";

export type Vec3 = [number, number, number];
export interface ObjectRef {
  ref: number;
}
export type PropValue =
  | number
  | boolean
  | string
  | Vec3
  | ObjectRef
  | PropValue[]
  | Props
  | null;
export type Props = { [name: string]: PropValue };

/** Struct types read natively (fixed binary layout) instead of as nested tagged properties. */
const NATIVE_STRUCTS: Record<string, (r: Reader, p: Package) => PropValue> = {
  Vector: (r) => [r.f32(), r.f32(), r.f32()],
  Rotator: (r) => [r.f32(), r.f32(), r.f32()],
  Vector2D: (r) => [r.f32(), r.f32()] as unknown as PropValue,
  Vector4: (r) => [r.f32(), r.f32(), r.f32(), r.f32()] as unknown as PropValue,
  Quat: (r) => [r.f32(), r.f32(), r.f32(), r.f32()] as unknown as PropValue,
  LinearColor: (r) => [r.f32(), r.f32(), r.f32(), r.f32()] as unknown as PropValue,
  Color: (r) => [r.u8(), r.u8(), r.u8(), r.u8()] as unknown as PropValue,
  IntPoint: (r) => [r.i32(), r.i32()] as unknown as PropValue,
  Guid: (r) => r.guid(),
  Box: (r) => {
    const v = [r.f32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32()];
    r.u8();
    return v as unknown as PropValue;
  },
};

/**
 * Read tagged properties until "None". Unknown/complex values are skipped by tag size,
 * so a parse error in one value never desyncs the stream.
 */
export function readProps(r: Reader, pkg: Package): Props {
  const out: Props = {};
  for (;;) {
    const name = pkg.fname(r);
    if (name === "None") break;
    const type = pkg.fname(r);
    const size = r.i32();
    const arrayIndex = r.i32();
    let structName = "";
    let innerType = "";
    let boolVal = false;
    switch (type) {
      case "StructProperty":
        structName = pkg.fname(r);
        r.guid();
        break;
      case "BoolProperty":
        boolVal = r.u8() !== 0;
        break;
      case "ByteProperty":
      case "EnumProperty":
        innerType = pkg.fname(r);
        break;
      case "ArrayProperty":
      case "SetProperty":
        innerType = pkg.fname(r);
        break;
      case "MapProperty":
        innerType = pkg.fname(r);
        pkg.fname(r);
        break;
    }
    if (r.u8()) r.guid(); // property guid

    const start = r.pos;
    const end = start + size;
    let value: PropValue = null;
    try {
      const sub = new Reader(r.bytes, start);
      value = type === "BoolProperty" ? boolVal : readValue(sub, pkg, type, structName, innerType, size);
    } catch {
      value = null;
    }
    r.pos = end;
    const key = arrayIndex ? `${name}[${arrayIndex}]` : name;
    out[key] = value;
  }
  return out;
}

function readValue(r: Reader, pkg: Package, type: string, structName: string, inner: string, size: number): PropValue {
  switch (type) {
    case "IntProperty":
      return r.i32();
    case "UInt32Property":
      return r.u32();
    case "FloatProperty":
      return r.f32();
    case "ByteProperty":
      return size === 1 ? r.u8() : pkg.fname(r);
    case "EnumProperty":
    case "NameProperty":
      return pkg.fname(r);
    case "StrProperty":
      return r.fstring();
    case "ObjectProperty":
    case "ClassProperty":
      return { ref: r.i32() };
    case "SoftObjectProperty":
      return pkg.fname(r) + (r.fstring() ? "" : "");
    case "TextProperty":
      return readText(r, pkg);
    case "StructProperty":
      return readStruct(r, pkg, structName);
    case "ArrayProperty":
      return readArray(r, pkg, inner);
    default:
      return null;
  }
}

/**
 * FText. Returns the source string, or { table, key } for a string-table reference.
 */
export function readText(r: Reader, pkg: Package): PropValue {
  r.u32(); // flags
  const history = r.i8();
  switch (history) {
    case -1: // None
      return r.bool32() ? r.fstring() : "";
    case 0: {
      // Base: namespace, key, source string
      const ns = r.fstring();
      const key = r.fstring();
      const src = r.fstring();
      return { ns, key, text: src } as unknown as PropValue;
    }
    case 11: {
      // StringTableEntry
      const table = pkg.fname(r);
      const key = r.fstring();
      return { table, key } as unknown as PropValue;
    }
    default:
      return null;
  }
}

function readStruct(r: Reader, pkg: Package, structName: string): PropValue {
  const native = NATIVE_STRUCTS[structName];
  if (native) return native(r, pkg);
  return readProps(r, pkg);
}

function readArray(r: Reader, pkg: Package, inner: string): PropValue {
  const count = r.i32();
  const out: PropValue[] = [];
  if (inner === "StructProperty") {
    // Inner tag describes the element struct.
    pkg.fname(r); // name
    pkg.fname(r); // type
    r.i32(); // size
    r.i32(); // array index
    const structName = pkg.fname(r);
    r.guid();
    if (r.u8()) r.guid();
    for (let i = 0; i < count; i++) out.push(readStruct(r, pkg, structName));
    return out;
  }
  for (let i = 0; i < count; i++) {
    switch (inner) {
      case "ObjectProperty":
        out.push({ ref: r.i32() });
        break;
      case "IntProperty":
        out.push(r.i32());
        break;
      case "FloatProperty":
        out.push(r.f32());
        break;
      case "NameProperty":
        out.push(pkg.fname(r));
        break;
      case "StrProperty":
        out.push(r.fstring());
        break;
      case "BoolProperty":
      case "ByteProperty":
        out.push(r.u8());
        break;
      default:
        return null;
    }
  }
  return out;
}
