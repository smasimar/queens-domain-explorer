import { CanvasTexture, Group, type PerspectiveCamera, Sprite, SpriteMaterial, Vector3 } from "three";
import type { CollectiblePoint, UiImage, WorkerApi } from "../protocol.ts";
import type { Progress } from "./progress.ts";
import { CATEGORY_BY_ID, type Settings } from "./settings.ts";

const SIZE = 64;
const SCALE = 0.065;
/** Hover pick radius in pixels. */
const PICK_PX = 26;

interface Skin {
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  material: SpriteMaterial;
  color: string;
  grey: boolean;
  icon: HTMLCanvasElement | null;
  /** Drawn glyph instead of an item icon (secret doors have no game icon). */
  glyph: ((g: CanvasRenderingContext2D, c: number, color: string) => void) | null;
}

/** Unique enemy: two crossed swords, tips up, crossing at the centre. */
function crossedSwords(g: CanvasRenderingContext2D, c: number, color: string): void {
  g.lineCap = "round";
  for (const dir of [1, -1]) {
    g.save();
    g.translate(c, c);
    g.rotate((dir * Math.PI) / 4);
    g.fillStyle = "#fff";
    g.beginPath(); // blade with a pointed tip
    g.moveTo(0, -19);
    g.lineTo(2.5, -15);
    g.lineTo(2.5, 7);
    g.lineTo(-2.5, 7);
    g.lineTo(-2.5, -15);
    g.closePath();
    g.fill();
    g.fillStyle = color;
    g.fillRect(-6, 7, 12, 3); // guard
    g.fillRect(-1.5, 10, 3, 6); // grip
    g.beginPath(); // pommel
    g.arc(0, 17.5, 2.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

/** Secret door: a brick wall with an arrow showing it slides open. */
function slidingWall(g: CanvasRenderingContext2D, c: number, color: string): void {
  const bw = 8, bh = 6, gap = 1.5;
  const left = c - 17, top = c - 13;
  g.fillStyle = color;
  g.save();
  g.beginPath();
  g.rect(left, top, 3 * bw + 2 * gap, 4 * bh + 3 * gap);
  g.clip();
  for (let r = 0; r < 4; r++) {
    const off = r % 2 ? -(bw + gap) / 2 : 0;
    for (let k = 0; k < 4; k++) g.fillRect(left + off + k * (bw + gap), top + r * (bh + gap), bw, bh);
  }
  g.restore();
  g.strokeStyle = "#fff";
  g.lineWidth = 3;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(c + 11, c);
  g.lineTo(c + 20, c);
  g.moveTo(c + 16, c - 5);
  g.lineTo(c + 21, c);
  g.lineTo(c + 16, c + 5);
  g.stroke();
}

function iconCanvas(img: UiImage): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const px = new Uint8ClampedArray(img.rgba.byteLength);
  px.set(img.rgba);
  c.getContext("2d")!.putImageData(new ImageData(px, img.width, img.height), 0, 0);
  return c;
}

/** Dark disc with a category ring; the item icon inside, or a diamond until it loads. */
function draw(s: Skin): void {
  const g = s.canvas.getContext("2d")!;
  g.clearRect(0, 0, SIZE, SIZE);
  g.save();
  if (s.grey) {
    g.filter = "grayscale(1)";
    g.globalAlpha = 0.45;
  }
  const c = SIZE / 2;
  g.beginPath();
  g.arc(c, c, c - 4, 0, Math.PI * 2);
  g.fillStyle = "rgba(10,12,10,0.6)";
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = s.color;
  g.stroke();
  if (s.glyph) s.glyph(g, c, s.color);
  else if (s.icon) {
    const k = (SIZE - 16) / Math.max(s.icon.width, s.icon.height);
    const w = s.icon.width * k, h = s.icon.height * k;
    g.drawImage(s.icon, c - w / 2, c - h / 2, w, h);
  } else {
    g.beginPath();
    g.moveTo(c, c - 13);
    g.lineTo(c + 13, c);
    g.lineTo(c, c + 13);
    g.lineTo(c - 13, c);
    g.closePath();
    g.fillStyle = s.color;
    g.fill();
  }
  g.restore();
  s.texture.needsUpdate = true;
}

/** The same thing placed in two levels closer than this (metres) is one collectible. */
const DUPLICATE_M = 2;

/**
 * Overlapping streaming levels sometimes place the same pickup twice at one spot
 * (e.g. a Vampiric Blade in both 450_MAUS_darkmaze and 500_AUT). The game keeps
 * one; merge them so the save state of either applies.
 */
export function mergeDuplicates(points: CollectiblePoint[]): CollectiblePoint[] {
  const out: CollectiblePoint[] = [];
  const byKey = new Map<string, CollectiblePoint[]>();
  for (const p of points) {
    const key = `${p.category}|${p.item ?? p.name}|${p.noteKey ?? ""}|${p.count}`;
    const same = byKey.get(key) ?? [];
    // Same-level clusters (e.g. four spike balls in a pile) are separate pickups.
    const twin = same.find((q) =>
      q.level !== p.level && Math.hypot(q.position[0] - p.position[0], q.position[1] - p.position[1], q.position[2] - p.position[2]) <
        DUPLICATE_M
    );
    if (twin) {
      twin.guids = [...twin.guids, ...p.guids];
      continue;
    }
    const copy = { ...p, guids: [...p.guids] };
    same.push(copy);
    byKey.set(key, same);
    out.push(copy);
  }
  return out;
}

export interface CategoryCount {
  total: number;
  collected: number;
}

/** Billboards for every placed collectible, filtered by category, range and save state. */
export class CollectibleLayer {
  readonly root = new Group();
  private sprites: Sprite[] = [];
  private skins = new Map<string, Skin>();
  private icons = new Map<string, Promise<HTMLCanvasElement | null>>();
  private progress: Progress | null = null;

  readonly points: CollectiblePoint[];

  constructor(private api: WorkerApi, points: CollectiblePoint[]) {
    this.points = mergeDuplicates(points);
    for (const p of this.points) {
      const s = new Sprite();
      s.position.set(p.position[0], p.position[1] + 0.6, p.position[2]);
      s.scale.setScalar(SCALE);
      s.renderOrder = 11;
      s.userData.point = p;
      this.root.add(s);
      this.sprites.push(s);
    }
    this.applySkins();
  }

  private skin(p: CollectiblePoint, grey: boolean): Skin {
    const key = `${p.category}|${p.icon ?? ""}|${grey ? 1 : 0}`;
    let s = this.skins.get(key);
    if (s) return s;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false, transparent: true });
    s = { canvas, texture, material, color: CATEGORY_BY_ID.get(p.category)?.color ?? "#fff", grey, icon: null, glyph: p.category === "doors" ? slidingWall : p.category === "enemies" ? crossedSwords : null };
    this.skins.set(key, s);
    draw(s);
    if (p.icon && !s.glyph) {
      const skin = s;
      this.loadIcon(p.icon).then((icon) => {
        if (!icon) return;
        skin.icon = icon;
        draw(skin);
      });
    }
    return s;
  }

  private loadIcon(path: string): Promise<HTMLCanvasElement | null> {
    let p = this.icons.get(path);
    if (!p) {
      p = this.api.icon(path).then((img) => (img ? iconCanvas(img) : null)).catch(() => null);
      this.icons.set(path, p);
    }
    return p;
  }

  private applySkins(): void {
    for (const s of this.sprites) {
      const p = s.userData.point as CollectiblePoint;
      const grey = this.progress?.collected(p) === true;
      s.userData.collected = this.progress ? this.progress.collected(p) : null;
      s.material = this.skin(p, grey).material;
    }
  }

  setProgress(progress: Progress | null): void {
    this.progress = progress;
    this.applySkins();
  }

  /** Every collectible sprite (userData: point, collected). */
  all(): readonly Sprite[] {
    return this.sprites;
  }

  counts(): Map<string, CategoryCount> {
    const out = new Map<string, CategoryCount>();
    for (const s of this.sprites) {
      const p = s.userData.point as CollectiblePoint;
      const c = out.get(p.category) ?? { total: 0, collected: 0 };
      c.total++;
      if (s.userData.collected === true) c.collected++;
      out.set(p.category, c);
    }
    return out;
  }

  /** Per-frame visibility: category toggle and draw range. */
  update(camera: PerspectiveCamera, settings: Settings): void {
    const r2 = settings.range * settings.range;
    for (const s of this.sprites) {
      const p = s.userData.point as CollectiblePoint;
      s.visible = settings.cats[p.category] && (settings.showCollected || s.userData.collected !== true) &&
        s.position.distanceToSquared(camera.position) < r2;
    }
  }

  /** The visible collectible nearest the screen centre, within a few pixels. */
  pick(camera: PerspectiveCamera, width: number, height: number): ScreenPick | null {
    return pickNearCentre(this.sprites, camera, width, height);
  }
}

export interface ScreenPick {
  sprite: Sprite;
  /** Squared pixel distance from the screen centre. */
  d2: number;
}

const tmp = new Vector3();

/** The visible sprite nearest the screen centre, within PICK_PX. */
export function pickNearCentre(
  sprites: Iterable<Sprite>,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): ScreenPick | null {
  let best: ScreenPick | null = null;
  for (const s of sprites) {
    if (!s.visible) continue;
    const v = tmp.copy(s.position).project(camera);
    if (v.z > 1) continue;
    const dx = (v.x * width) / 2, dy = (v.y * height) / 2;
    const d2 = dx * dx + dy * dy;
    if (d2 < PICK_PX * PICK_PX && (!best || d2 < best.d2)) best = { sprite: s, d2 };
  }
  return best;
}

/** HUD text for a hovered collectible, one part per line. */
export function describe(s: Sprite, hasSave: boolean): string {
  const p = s.userData.point as CollectiblePoint;
  const opens = p.category === "chests" || p.category === "doors";
  const foe = p.category === "enemies";
  const parts = [p.count > 1 ? `${p.name} ×${p.count}` : p.name];
  // "Chest" and "Secret door" already name their category.
  const one = CATEGORY_BY_ID.get(p.category)?.one ?? p.category;
  if (!opens && one !== p.name) parts.push(one);
  if (p.hiddenBy) parts.push(p.hiddenBy);
  if (hasSave) {
    const c = s.userData.collected as boolean | null;
    parts.push(c === null ? "save state unknown" : opens ? (c ? "opened" : "not opened") : foe ? (c ? "killed" : "not killed") : c ? "collected" : "not collected");
  }
  return parts.join("\n");
}
