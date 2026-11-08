import type { Package } from "./package.ts";
import { readProps, type Props, type Vec3 } from "./properties.ts";
import { fromQuat, type Xform } from "./transform.ts";

/** A Crystal Monument or Wing Altar location data asset (Blueprints/Areas/<folder>/<asset>). */
export interface LocationAsset {
  asset: string; // object path
  folder: string; // e.g. "1GreenRuins"
  kind: "fasttravel" | "save";
  /** Area display name, e.g. "Isle of Neasied". */
  area: string;
  /** Point display name, e.g. "Knight's Encampment" (Wing Altar: area name). */
  name: string;
  sort: number;
  /** Where the game puts the player when travelling here. */
  dest: Xform;
}

type Strings = Map<string, string>;

function text(v: unknown, strings: Strings): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  const t = v as { table?: string; key?: string; text?: string };
  if (t.table && t.key) return strings.get(t.key) ?? t.key;
  return t.text ?? "";
}

/** Parse a location asset. Returns null for test zones and special teleports. */
export function parseLocationAsset(pkg: Package, strings: Strings): LocationAsset | null {
  const exp = pkg.exports[0];
  if (!exp) return null;
  const cls = pkg.exportClass(exp);
  if (cls !== "AreaName_C" && cls !== "TeleporterData_C") return null;
  const p = readProps(pkg.exportReader(exp), pkg);
  const dest = p.TeleportDestTransform as Props | undefined;
  if (!dest || typeof p.Sort !== "number") return null;
  const type = typeof p.LocationType === "string" ? p.LocationType : "";
  if (type.includes("SpecialTeleport")) return null;
  const kind = type.includes("FSLT_Teleporter") ? "fasttravel" : "save";
  const area = text(p.Name, strings);
  const parts = pkg.path.split("/");
  const assetName = exp.objectName;
  const objectPath = "/Game/" + pkg.path.replace(/^QueensDomain\/Content\//, "").replace(/\.uasset$/, "") + "." + assetName;
  return {
    asset: objectPath,
    folder: parts[parts.length - 2],
    kind,
    area,
    name: kind === "fasttravel" ? area : text(p.AreaName, strings) || area,
    sort: p.Sort,
    dest: fromQuat(dest.Rotation as never, dest.Translation as Vec3, [1, 1, 1]),
  };
}
