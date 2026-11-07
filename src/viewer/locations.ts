import { CanvasTexture, Group, type PerspectiveCamera, Sprite, SpriteMaterial, Vector3 } from "three";
import type { LocationGroup, LocationPoint } from "../protocol.ts";
import type { NoclipControls } from "./controls.ts";

const COLORS = { fasttravel: "#5fb8ff", save: "#7be07b" };

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

/** Screen-space icons above every altar; visible through geometry. */
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
      root.add(s);
    }
  }
  return root;
}

/** Move the camera to view an altar from in front of it. */
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

/** Left-side teleport menu, grouped by area: fast travel first, then save altars. */
export function createLocationMenu(
  el: HTMLElement,
  groups: LocationGroup[],
  onPick: (p: LocationPoint) => void,
): void {
  el.innerHTML = "";
  const head = document.createElement("div");
  head.className = "menu-head";
  head.innerHTML = `<span>Fast Travel</span><kbd>M</kbd>`;
  el.appendChild(head);
  const list = document.createElement("div");
  list.className = "menu-list";
  for (const g of groups) {
    const sec = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = g.area;
    sec.appendChild(h);
    for (const p of g.points) {
      const b = document.createElement("button");
      b.className = `loc ${p.kind}`;
      b.title = p.placed ? `${p.level}` : "Altar's sublevel not loaded: shows the travel destination";
      b.innerHTML = `<i></i><span></span>`;
      b.querySelector("span")!.textContent = p.kind === "fasttravel" ? "Fast travel" : p.name;
      if (!p.placed) b.classList.add("approx");
      b.onclick = () => {
        el.querySelector("button.loc.active")?.classList.remove("active");
        b.classList.add("active");
        onPick(p);
      };
      sec.appendChild(b);
    }
    list.appendChild(sec);
  }
  el.appendChild(list);
}
