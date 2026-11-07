import { Reader } from "./reader.ts";

const PACKAGE_TAG = 0x9e2a83c1;
export const PKG_FilterEditorOnly = 0x80000000;
export const PKG_UnversionedProperties = 0x00002000;

export interface ObjectImport {
  classPackage: string;
  className: string;
  outerIndex: number;
  objectName: string;
}

export interface ObjectExport {
  classIndex: number;
  superIndex: number;
  templateIndex: number;
  outerIndex: number;
  objectName: string;
  objectFlags: number;
  serialSize: number;
  serialOffset: number;
}

export interface PackageSummary {
  totalHeaderSize: number;
  packageFlags: number;
  bulkDataStartOffset: number;
  engineVersion: string;
}

/** Bytes for one cooked package: header (.uasset/.umap), exports (.uexp), optional bulk (.ubulk). */
export interface PackageFiles {
  header: Uint8Array;
  exports: Uint8Array;
  bulk?: Uint8Array;
}

/** Cooked UE4.26/4.27 package (unversioned summary, tagged properties). */
export class Package {
  summary!: PackageSummary;
  names: string[] = [];
  imports: ObjectImport[] = [];
  exports: ObjectExport[] = [];

  constructor(readonly path: string, readonly files: PackageFiles) {
    this.parseHeader();
  }

  private parseHeader(): void {
    const r = new Reader(this.files.header);
    if (r.u32() !== PACKAGE_TAG) throw new Error(`${this.path}: bad package tag`);
    const legacy = r.i32();
    if (legacy !== -7 && legacy !== -6) throw new Error(`${this.path}: unsupported legacy version ${legacy}`);
    r.i32(); // LegacyUE3Version
    const ue4 = r.i32();
    r.i32(); // licensee
    if (ue4 !== 0) throw new Error(`${this.path}: expected unversioned package, got UE4 ver ${ue4}`);
    r.array(() => r.skip(20)); // custom versions
    const totalHeaderSize = r.i32();
    r.fstring(); // folder name
    const packageFlags = r.u32();
    if (packageFlags & PKG_UnversionedProperties) throw new Error(`${this.path}: unversioned properties are not supported`);
    const nameCount = r.i32();
    const nameOffset = r.i32();
    if (!(packageFlags & PKG_FilterEditorOnly)) r.fstring(); // LocalizationId
    r.i32(); // gatherable text count
    r.i32(); // gatherable text offset
    const exportCount = r.i32();
    const exportOffset = r.i32();
    const importCount = r.i32();
    const importOffset = r.i32();
    r.i32(); // depends offset
    r.i32(); // soft package refs count
    r.i32(); // soft package refs offset
    r.i32(); // searchable names offset
    r.i32(); // thumbnail table offset
    r.guid();
    r.array(() => r.skip(8)); // generations
    const engineVersion = readEngineVersion(r);
    readEngineVersion(r); // compatible
    r.u32(); // compression flags
    if (r.i32() !== 0) throw new Error(`${this.path}: compressed packages not supported`);
    r.u32(); // package source
    r.array(() => r.fstring()); // additional packages to cook
    r.i32(); // asset registry data offset
    const bulkDataStartOffset = r.i64();
    this.summary = { totalHeaderSize, packageFlags, bulkDataStartOffset, engineVersion };

    r.pos = nameOffset;
    for (let i = 0; i < nameCount; i++) {
      this.names.push(r.fstring());
      r.skip(4); // hashes
    }

    r.pos = importOffset;
    for (let i = 0; i < importCount; i++) {
      this.imports.push({
        classPackage: this.fname(r),
        className: this.fname(r),
        outerIndex: r.i32(),
        objectName: this.fname(r),
      });
    }

    r.pos = exportOffset;
    for (let i = 0; i < exportCount; i++) {
      const classIndex = r.i32();
      const superIndex = r.i32();
      const templateIndex = r.i32();
      const outerIndex = r.i32();
      const objectName = this.fname(r);
      const objectFlags = r.u32();
      const serialSize = r.i64();
      const serialOffset = r.i64();
      r.skip(4 * 3 + 16 + 4 + 4 + 4 + 4 * 5);
      this.exports.push({ classIndex, superIndex, templateIndex, outerIndex, objectName, objectFlags, serialSize, serialOffset });
    }
  }

  /** Read an FName (index + number). */
  fname(r: Reader): string {
    const idx = r.i32();
    const num = r.i32();
    const base = this.names[idx];
    if (base === undefined) throw new Error(`${this.path}: bad name index ${idx} at ${r.pos - 8}`);
    return num ? `${base}_${num - 1}` : base;
  }

  /** Name of the object a package index points at (export > 0, import < 0). */
  indexName(i: number): string {
    if (i > 0) return this.exports[i - 1]?.objectName ?? "?";
    if (i < 0) return this.imports[-i - 1]?.objectName ?? "?";
    return "None";
  }

  /** Class name of an export. */
  exportClass(e: ObjectExport): string {
    return this.indexName(e.classIndex);
  }

  /** Full object path of an import, e.g. "/Game/Props/SM_Rock.SM_Rock". */
  importPath(i: number): string {
    const parts: string[] = [];
    let cur = i;
    while (cur < 0) {
      const imp = this.imports[-cur - 1];
      parts.unshift(imp.objectName);
      cur = imp.outerIndex;
    }
    if (parts.length === 1) return parts[0];
    return parts[0] + "." + parts.slice(1).join(":");
  }

  /** Reader positioned on an export's serialized data (in .uexp). */
  exportReader(e: ObjectExport): Reader {
    const start = e.serialOffset - this.summary.totalHeaderSize;
    return new Reader(this.files.exports.subarray(start, start + e.serialSize));
  }
}

function readEngineVersion(r: Reader): string {
  const major = r.u16();
  const minor = r.u16();
  const patch = r.u16();
  const cl = r.u32();
  const branch = r.fstring();
  return `${major}.${minor}.${patch}-${cl}+${branch}`;
}
