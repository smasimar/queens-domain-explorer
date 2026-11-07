import type { Package } from "./package.ts";
import { readProps, type Props } from "./properties.ts";
import { Reader } from "./reader.ts";

export interface MeshSection {
  materialIndex: number;
  firstIndex: number;
  numTriangles: number;
}

/** LOD0 geometry in UE space (cm, Z-up, left-handed). */
export interface MeshData {
  name: string;
  positions: Float32Array;
  /** One Float32Array (u,v pairs) per UV channel. */
  uvs: Float32Array[];
  indices: Uint32Array;
  sections: MeshSection[];
  /** Material object paths, indexed by section.materialIndex. */
  materials: (string | null)[];
}

const CDSF_ReversedIndexBuffer = 2;

function strip(r: Reader) {
  const global = r.u8();
  const cls = r.u8();
  return {
    editorStripped: (global & 1) !== 0,
    serverStripped: (global & 2) !== 0,
    classStripped: (f: number) => (cls & f) !== 0,
  };
}

/** Parse the first StaticMesh export of a cooked package. */
export function parseStaticMesh(pkg: Package): MeshData {
  const exp = pkg.exports.find((e) => pkg.exportClass(e) === "StaticMesh");
  if (!exp) throw new Error(`${pkg.path}: no StaticMesh export`);
  const r = pkg.exportReader(exp);
  const props: Props = readProps(r, pkg);
  if (exp.objectFlags & 0x10 /* RF_ClassDefaultObject */) throw new Error("CDO");
  if (r.bool32()) r.guid(); // object guid

  const sf = strip(r);
  const cooked = r.bool32();
  if (!cooked) throw new Error(`${pkg.path}: mesh not cooked`);
  r.i32(); // BodySetup
  r.i32(); // NavCollision
  if (!sf.editorStripped) throw new Error(`${pkg.path}: editor data present`);
  r.guid(); // lighting guid
  r.array(() => r.i32()); // sockets

  // FStaticMeshRenderData
  const lodCount = r.i32();
  if (lodCount < 1) throw new Error(`${pkg.path}: no LODs`);
  const lod = readLod(r, pkg);

  const materials = readMaterialsFromProps(pkg, props);
  return { name: exp.objectName, ...lod, materials };
}

function readLod(r: Reader, pkg: Package): Omit<MeshData, "name" | "materials"> {
  const sf = strip(r);
  const sections: MeshSection[] = r.array(() => {
    const materialIndex = r.i32();
    const firstIndex = r.i32();
    const numTriangles = r.i32();
    r.i32(); // min vertex
    r.i32(); // max vertex
    r.bool32(); // collision
    r.bool32(); // cast shadow
    r.bool32(); // force opaque
    r.bool32(); // visible in ray tracing
    return { materialIndex, firstIndex, numTriangles };
  });
  r.f32(); // max deviation
  if (sf.serverStripped || sf.classStripped(1)) throw new Error(`${pkg.path}: LOD data stripped`);
  const cookedOut = r.bool32();
  const inlined = r.bool32();
  if (cookedOut) throw new Error(`${pkg.path}: LOD0 cooked out`);
  let buf: Reader = r;
  if (!inlined) {
    const data = readBulkData(r, pkg);
    buf = new Reader(data);
  }
  return { ...readBuffers(buf), sections };
}

function readBuffers(r: Reader): Omit<MeshData, "name" | "materials" | "sections"> {
  strip(r);
  // FPositionVertexBuffer
  r.i32(); // stride
  const numVerts = r.i32();
  const posElem = r.i32();
  const posCount = r.i32();
  if (posElem !== 12 || posCount !== numVerts) throw new Error(`bad position buffer ${posElem}x${posCount}`);
  const positions = new Float32Array(numVerts * 3);
  for (let i = 0; i < numVerts * 3; i++) positions[i] = r.f32();

  // FStaticMeshVertexBuffer
  strip(r);
  const numTex = r.i32();
  const nv = r.i32();
  const fullUV = r.bool32();
  const highTangent = r.bool32();
  if (nv !== numVerts) throw new Error("vertex count mismatch");
  const tElem = r.i32();
  const tCount = r.i32();
  r.skip(tElem * tCount); // tangents (normals recomputed on load)
  void highTangent;
  const uvElem = r.i32();
  const uvCount = r.i32();
  const uvs: Float32Array[] = [];
  for (let c = 0; c < numTex; c++) uvs.push(new Float32Array(numVerts * 2));
  const uvStart = r.pos;
  const perVert = numTex * (fullUV ? 8 : 4);
  if (uvElem * uvCount !== perVert * numVerts) throw new Error("uv size mismatch");
  for (let v = 0; v < numVerts; v++) {
    r.pos = uvStart + v * perVert;
    for (let c = 0; c < numTex; c++) {
      const uv = uvs[c];
      if (fullUV) {
        uv[v * 2] = r.f32();
        uv[v * 2 + 1] = r.f32();
      } else {
        uv[v * 2] = half(r.u16());
        uv[v * 2 + 1] = half(r.u16());
      }
    }
  }
  r.pos = uvStart + uvElem * uvCount;

  // FColorVertexBuffer
  strip(r);
  r.i32(); // stride
  const nColor = r.i32();
  if (nColor > 0) {
    const ce = r.i32();
    const cc = r.i32();
    r.skip(ce * cc);
  }

  // FRawStaticIndexBuffer
  const is32 = r.bool32();
  const ie = r.i32();
  const ic = r.i32();
  const raw = r.take(ie * ic);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const n = is32 ? raw.byteLength / 4 : raw.byteLength / 2;
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) indices[i] = is32 ? dv.getUint32(i * 4, true) : dv.getUint16(i * 2, true);
  return { positions, uvs, indices };
}

/** StaticMaterials from tagged props; falls back to material imports in order. */
function readMaterialsFromProps(pkg: Package, props: Props): (string | null)[] {
  const sm = props.StaticMaterials as Props[] | null | undefined;
  if (Array.isArray(sm)) {
    return sm.map((m) => {
      const ref = (m as Props)?.MaterialInterface as { ref: number } | undefined;
      return ref && ref.ref < 0 ? pkg.importPath(ref.ref) : null;
    });
  }
  return pkg.imports
    .map((imp, i) => ({ imp, i }))
    .filter(({ imp }) => /^Material/.test(imp.className))
    .map(({ i }) => pkg.importPath(-i - 1));
}

const BULKDATA_PayloadAtEndOfFile = 0x0001;
const BULKDATA_Unused = 0x0020;
const BULKDATA_ForceInlinePayload = 0x0040;
const BULKDATA_PayloadInSeperateFile = 0x0100;
const BULKDATA_Size64Bit = 0x2000;
const BULKDATA_NoOffsetFixUp = 0x10000;

/** Read FByteBulkData header and return its payload. */
export function readBulkData(r: Reader, pkg: Package): Uint8Array {
  const flags = r.u32();
  const count = flags & BULKDATA_Size64Bit ? r.i64() : r.i32();
  const sizeOnDisk = flags & BULKDATA_Size64Bit ? r.i64() : r.i32();
  let offset = r.i64();
  void count;
  if (flags & BULKDATA_Unused || sizeOnDisk === 0) return new Uint8Array(0);
  if (flags & BULKDATA_ForceInlinePayload) return r.take(sizeOnDisk);
  if (flags & BULKDATA_PayloadInSeperateFile) {
    const bulk = pkg.files.bulk;
    if (!bulk) throw new Error(`${pkg.path}: missing .ubulk`);
    if (offset + sizeOnDisk > bulk.length) throw new Error(`${pkg.path}: bulk range out of .ubulk`);
    return bulk.subarray(offset, offset + sizeOnDisk);
  }
  if (flags & BULKDATA_PayloadAtEndOfFile) {
    if (!(flags & BULKDATA_NoOffsetFixUp)) offset += pkg.summary.bulkDataStartOffset;
    const start = offset - pkg.summary.totalHeaderSize;
    return pkg.files.exports.subarray(start, start + sizeOnDisk);
  }
  throw new Error(`${pkg.path}: unsupported bulk flags 0x${flags.toString(16)}`);
}

function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
