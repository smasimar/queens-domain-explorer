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
  if (s.icon) {
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
  private tmp = new Vector3();

  constructor(private api: WorkerApi, readonly points: CollectiblePoint[]) {
    for (const p of points) {
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
    s = { canvas, texture, material, color: CATEGORY_BY_ID.get(p.category)?.color ?? "#fff", grey, icon: null };
    this.skins.set(key, s);
    draw(s);
    if (p.icon) {
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
  pick(camera: PerspectiveCamera, width: number, height: number): Sprite | null {
    let best: Sprite | null = null;
    let bestD = PICK_PX * PICK_PX;
    for (const s of this.sprites) {
      if (!s.visible) continue;
      const v = this.tmp.copy(s.position).project(camera);
      if (v.z > 1) continue;
      const dx = (v.x * width) / 2, dy = (v.y * height) / 2;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }
}

/** HUD text for a hovered collectible. */
export function describe(s: Sprite, hasSave: boolean): string {
  const p = s.userData.point as CollectiblePoint;
  const cat = CATEGORY_BY_ID.get(p.category)?.label ?? p.category;
  const parts = [p.count > 1 ? `${p.name} ×${p.count}` : p.name, cat];
  if (p.hiddenBy) parts.push(p.hiddenBy);
  if (hasSave) {
    const c = s.userData.collected as boolean | null;
    parts.push(c === null ? "save state unknown" : c ? (p.category === "chests" ? "opened" : "collected") : "not collected");
  }
  return parts.join(" · ");
}
