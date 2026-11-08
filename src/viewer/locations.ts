import { CanvasTexture, Group, type PerspectiveCamera, Sprite, SpriteMaterial, Vector3 } from "three";
import type { LocationGroup, LocationPoint } from "../protocol.ts";
import type { NoclipControls } from "./controls.ts";
import type { Progress } from "./progress.ts";
import type { Settings } from "./settings.ts";

const COLORS = { fasttravel: "#5fb8ff", save: "#7be07b" };
/** The game's names for the two landmark kinds. */
export const LANDMARK = { fasttravel: "Wing Altar", save: "Crystal Monument" } as const;

function iconTexture(kind: LocationPoint["kind"]): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.translate(32, 32);
  g.fillStyle = "rgba(0,0,0,0.55)";
  g.strokeStyle = COLORS[kind];
  g.lineWidth = 6;
  g.beginPath();
  if (kind === "fasttravel") {
    g.moveTo(0, -26);
    g.lineTo(26, 0);
    g.lineTo(0, 26);
    g.lineTo(-26, 0);
    g.closePath();
  } else {
    g.arc(0, 0, 22, 0, Math.PI * 2);
  }
  g.fill();
  g.stroke();
  g.fillStyle = COLORS[kind];
  g.beginPath();
  g.arc(0, 0, 8, 0, Math.PI * 2);
  g.fill();
  return new CanvasTexture(c);
}

/** Screen-space icons above every Wing Altar and Crystal Monument; visible through geometry. */
export function createMarkers(groups: LocationGroup[]): Group {
  const root = new Group();
  const mats = {
    fasttravel: new SpriteMaterial({ map: iconTexture("fasttravel"), depthTest: false, sizeAttenuation: false }),
    save: new SpriteMaterial({ map: iconTexture("save"), depthTest: false, sizeAttenuation: false }),
  };
  for (const g of groups) {
    for (const p of g.points) {
      if (!p.placed) continue;
      const s = new Sprite(mats[p.kind]);
      s.position.set(p.position[0], p.position[1] + 3.2, p.position[2]);
      s.scale.setScalar(0.028);
      s.renderOrder = 10;
      s.userData.point = p;
      s.userData.area = g.area;
      root.add(s);
    }
  }
  return root;
}

/** HUD text for a hovered landmark, one part per line. Wing Altars are named after their area. */
export function describeLocation(s: Sprite, progress: Progress | null): string {
  const p = s.userData.point as LocationPoint;
  const area = s.userData.area as string;
  const parts = p.kind === "fasttravel"
    ? [p.name, LANDMARK.fasttravel]
    : [area, p.name, LANDMARK.save].filter((x, i, a) => x && a.indexOf(x) === i);
  if (progress && !progress.unlocked(p)) parts.push("not unlocked");
  return parts.join("\n");
}

/** Whether a Wing Altar / Crystal Monument shows (in 3D and in the list) for these settings and save. */
export function locationVisible(p: LocationPoint, settings: Settings, progress: Progress | null): boolean {
  return settings.showLocked || !progress || progress.unlocked(p);
}

/** Per-frame marker visibility: kind toggle, lock state and draw range. */
export function updateMarkers(
  markers: Group,
  camera: PerspectiveCamera,
  settings: Settings,
  progress: Progress | null,
): void {
  const r2 = settings.range * settings.range;
  for (const s of markers.children) {
    const p = s.userData.point as LocationPoint;
    const on = p.kind === "fasttravel" ? settings.teleporters : settings.saves;
    s.visible = on && locationVisible(p, settings, progress) && s.position.distanceToSquared(camera.position) < r2;
  }
}

/** Move the camera to view a Wing Altar / Crystal Monument from in front of it. */
export function flyTo(p: LocationPoint, camera: PerspectiveCamera, controls: NoclipControls): void {
  const pos = new Vector3(...p.position);
  const f = new Vector3(p.forward[0], 0, p.forward[2]);
  if (f.lengthSq() < 1e-6) f.set(1, 0, 0);
  f.normalize();
  let eye: Vector3, target: Vector3;
  if (p.placed) {
    eye = pos.clone().addScaledVector(f, 7).add(new Vector3(0, 3.5, 0));
    target = pos.clone().add(new Vector3(0, 1.2, 0));
  } else {
    eye = pos.clone().add(new Vector3(0, 1.7, 0));
    target = eye.clone().add(f);
  }
  camera.position.copy(eye);
  const d = target.sub(eye).normalize();
  controls.setYawPitch(Math.atan2(-d.x, -d.z), Math.asin(Math.max(-1, Math.min(1, d.y))));
}

/** Wing Altars tab: grouped by area, the Wing Altar first, then Crystal Monuments. */
export function renderLocationList(
  list: HTMLElement,
  groups: LocationGroup[],
  onPick: (p: LocationPoint) => void,
  visible: (p: LocationPoint) => boolean,
): void {
  list.innerHTML = "";
  for (const g of groups) {
    const points = g.points.filter(visible);
    if (!points.length) continue;
    const sec = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = g.area;
    sec.appendChild(h);
    for (const p of points) {
      const b = document.createElement("button");
      b.className = `loc ${p.kind}`;
      b.title = p.placed ? `${p.level}` : "Sublevel not loaded: shows the travel destination";
      b.innerHTML = `<i></i><span></span>`;
      b.querySelector("span")!.textContent = p.kind === "fasttravel" ? LANDMARK.fasttravel : p.name;
      if (!p.placed) b.classList.add("approx");
      b.onclick = () => {
        list.querySelector("button.loc.active")?.classList.remove("active");
        b.classList.add("active");
        onPick(p);
      };
      sec.appendChild(b);
    }
    list.appendChild(sec);
  }
  if (!list.children.length) list.innerHTML = `<p class="menu-empty">No unlocked Wing Altars or Crystal Monuments in this save.</p>`;
}
