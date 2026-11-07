/** Data shapes passed between the parser worker and the viewer (three.js space, metres). */

export interface SceneActor {
  level: string;
  mesh: string;
  /** Column-major 4x4. */
  matrix: number[];
  overrides: (string | null)[];
}

export interface LocationPoint {
  kind: "fasttravel" | "save";
  name: string;
  /** Altar position (or the game's travel destination if the altar is not in a loaded sublevel). */
  position: [number, number, number];
  /** Altar facing (unit vector). */
  forward: [number, number, number];
  placed: boolean;
  level: string | null;
}

export interface LocationGroup {
  area: string;
  points: LocationPoint[];
}

export interface SceneData {
  levels: string[];
  spawn: { position: [number, number, number]; yaw: number } | null;
  actors: SceneActor[];
  locations: LocationGroup[];
}

export interface GeometryData {
  positions: Float32Array;
  uvs: Float32Array[];
  indices: Uint32Array;
  sections: { materialIndex: number; firstIndex: number; numTriangles: number }[];
  materials: (string | null)[];
}

export interface MaterialData {
  baseColor: string | null;
  uvChannel: number;
  normal: string | null;
}

export interface TextureMipData {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface TextureData {
  format: string;
  srgb: boolean;
  isNormalMap: boolean;
  mips: TextureMipData[];
}

export interface UiImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** In-game UI look, extracted from the user's pak at runtime (never bundled). */
export interface UiAssets {
  fonts: { regular: Uint8Array | null; light: Uint8Array | null };
  images: { frame: UiImage | null; panel: UiImage | null; dot: UiImage | null };
}

export interface WorkerApi {
  /** Open a pak file. Returns cache namespace. */
  open(file: File): Promise<string>;
  /** Dev only: open a pak served over HTTP with Range support. */
  openUrl(url: string): Promise<string>;
  /** Use cache only (no pak). */
  openCache(ns: string): Promise<void>;
  scene(levels: string[]): Promise<SceneData>;
  geometry(path: string): Promise<GeometryData>;
  material(path: string): Promise<MaterialData>;
  texture(path: string): Promise<TextureData>;
  uiAssets(): Promise<UiAssets>;
}
