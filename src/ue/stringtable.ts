import type { Package } from "./package.ts";
import { readProps } from "./properties.ts";

/** Parse a cooked UStringTable into key → (English) source string. */
export function parseStringTable(pkg: Package): Map<string, string> {
  const exp = pkg.exports.find((e) => pkg.exportClass(e) === "StringTable");
  if (!exp) throw new Error(`${pkg.path}: no StringTable export`);
  const r = pkg.exportReader(exp);
  readProps(r, pkg);
  if (r.bool32()) r.guid();
  r.fstring(); // namespace
  const out = new Map<string, string>();
  const n = r.i32();
  for (let i = 0; i < n; i++) {
    const key = r.fstring();
    out.set(key, r.fstring());
  }
  return out;
}
