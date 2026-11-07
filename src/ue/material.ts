import type { Package } from "./package.ts";
import { readProps, type ObjectRef, type Props } from "./properties.ts";

export interface MaterialInfo {
  /** Texture2D object path for base color, or null. */
  baseColor: string | null;
  /** UV channel the base color texture samples. */
  uvChannel: number;
  normal: string | null;
}

const PRIMARY_PARAM = /^(Texture_Main|Base_?Color|Diffuse|Albedo|Main_?Texture|Texture|Color)$/i;
const BASE_PARAM = /main|base|diff|albedo|colou?r|tex/i;
const NOT_BASE = /normal|nrm|mask|blend|rough|metal|spec|emiss|glow|height|noise|alpha|opacity|ao\b|_orm|_rma|cube|bayer|pall?ette|flow|detail|trim|alternate|fog|lut/i;
const NORMAL = /normal|nrm|_n$/i;

export type PackageLoader = (objectPath: string) => Promise<Package | null>;

/** Resolve base color (and normal) texture for a material or material instance, walking parents. */
export async function resolveMaterial(path: string, load: PackageLoader, depth = 0): Promise<MaterialInfo> {
  const none: MaterialInfo = { baseColor: null, uvChannel: 0, normal: null };
  if (depth > 6) return none;
  const pkg = await load(path);
  if (!pkg) return none;
  const exp = pkg.exports.find((e) => /^Material/.test(pkg.exportClass(e)));
  if (!exp) return none;
  let props: Props = {};
  try {
    props = readProps(pkg.exportReader(exp), pkg);
  } catch {
    /* keep empty */
  }

  const texPath = (v: unknown): string | null => {
    const ref = v && typeof v === "object" && "ref" in v ? (v as ObjectRef).ref : 0;
    return ref < 0 ? pkg.importPath(ref) : null;
  };

  const params: { name: string; path: string }[] = [];
  for (const p of (props.TextureParameterValues as Props[] | undefined) ?? []) {
    const name = ((p?.ParameterInfo as Props)?.Name as string) ?? "";
    const tp = texPath(p?.ParameterValue);
    if (tp) params.push({ name, path: tp });
  }

  const streaming = new Map<string, number>();
  for (const s of (props.TextureStreamingData as Props[] | undefined) ?? []) {
    if (typeof s?.TextureName === "string") streaming.set(s.TextureName, (s.UVChannelIndex as number) ?? 0);
  }
  const uvOf = (p: string | null) => (p ? streaming.get(p.split(".").pop()!) ?? 0 : 0);

  let base =
    params.find((p) => PRIMARY_PARAM.test(p.name))?.path ??
    params.find((p) => BASE_PARAM.test(p.name) && !NOT_BASE.test(p.name))?.path ??
    null;
  let normal = params.find((p) => NORMAL.test(p.name))?.path ?? null;

  const parent = texPath(props.Parent);
  if ((!base || !normal) && parent && !parent.startsWith("/Engine/")) {
    const pi = await resolveMaterial(parent, load, depth + 1);
    if (!base && pi.baseColor) {
      base = pi.baseColor;
      // Prefer this material's streaming info for the inherited texture.
      const uv = streaming.has(base.split(".").pop()!) ? uvOf(base) : pi.uvChannel;
      return { baseColor: base, uvChannel: uv, normal: normal ?? pi.normal };
    }
    normal = normal ?? pi.normal;
  }

  if (!base && depth === 0 || (!base && !parent)) {
    // Base material (or no params): guess from referenced textures.
    const tex = pkg.imports
      .map((imp, i) => ({ imp, path: pkg.importPath(-i - 1) }))
      .filter(({ imp, path }) => imp.className === "Texture2D" && path.startsWith("/Game/"));
    base = tex.find(({ imp }) => !NOT_BASE.test(imp.objectName) && !NORMAL.test(imp.objectName))?.path ?? null;
  }
  return { baseColor: base, uvChannel: uvOf(base), normal };
}
