import {
  ACESFilmicToneMapping,
  Clock,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  type Mesh,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from "three";
import { clearAllCaches, readLastNamespace } from "./cache.ts";
import { Compass3D } from "./viewer/compass.ts";
import { NoclipControls } from "./viewer/controls.ts";
import { createLocationMenu, createMarkers, flyTo } from "./viewer/locations.ts";
import { createWorkerApi } from "./viewer/rpc.ts";
import { applyGameTheme } from "./viewer/theme.ts";
import { World } from "./viewer/world.ts";
import { ALL_LEVELS, areaLabel, PHASE1_LEVELS } from "./viewer/zones.ts";
import "@fontsource/arvo/400.css";
import "@fontsource/arvo/400-italic.css";
import "./style.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const landing = $("landing");
const status = $("status");
const hud = $("hud");
const zoneLabel = $("zone");
const info = $("info");

const params = new URLSearchParams(location.search);
// Default: the whole world. ?levels=phase1 or ?levels=100_GR,200_AQ for a subset.
const levelsParam = params.get("levels");
const levels = !levelsParam || levelsParam === "all"
  ? ALL_LEVELS
  : levelsParam === "phase1"
  ? PHASE1_LEVELS
  : levelsParam.split(",").filter(Boolean);

const api = createWorkerApi();

async function init() {
  const ns = await readLastNamespace();
  const cacheBtn = $<HTMLButtonElement>("open-cache");
  if (ns) {
    cacheBtn.hidden = false;
    cacheBtn.onclick = () => run(async () => api.openCache(ns));
  }
  // The file row is a <label>; make Enter/Space open the picker too.
  document.querySelector<HTMLLabelElement>('label[for="pak"]')!.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      $<HTMLInputElement>("pak").click();
    }
  });
  $<HTMLInputElement>("pak").onchange = (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) run(async () => void (await api.open(file)));
  };
  // Dev only: ?devpak loads the pak from the dir in QD_PAK_DIR via the dev server.
  if (import.meta.env.DEV && params.has("devpak")) {
    run(async () => void (await api.openUrl("/@pak/QueensDomain-WindowsNoEditor.pak")));
  }
  $<HTMLButtonElement>("clear-cache").onclick = async () => {
    await clearAllCaches();
    cacheBtn.hidden = true;
    status.textContent = "Cache cleared.";
  };
}

async function run(open: () => Promise<void>) {
  try {
    status.textContent = "Reading pak index…";
    await open();
    status.textContent = `Reading ${levels.length} sublevels…`;
    const scene = await api.scene(levels);
    await start(scene);
  } catch (e) {
    console.error(e);
    status.textContent = `Error: ${(e as Error).message}`;
  }
}

async function start(sceneData: Awaited<ReturnType<typeof api.scene>>) {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  const sky = new Color(0x9cc4e4);
  const scene = new Scene();
  scene.background = sky;
  scene.fog = new Fog(sky, 400, 4000);
  scene.add(new HemisphereLight(0xdfefff, 0x5a4a3a, 1.6));
  const sun = new DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(0.5, 1, 0.3);
  scene.add(sun);

  const camera = new PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 8000);
  const controls = new NoclipControls(camera, renderer.domElement);
  if (sceneData.spawn) {
    const [x, y, z] = sceneData.spawn.position;
    camera.position.set(x, y + 0.9, z);
    controls.setYawPitch(-(sceneData.spawn.yaw * Math.PI / 180 + Math.PI / 2));
  }

  const world = new World(api, renderer);
  scene.add(world.root);
  const markers = createMarkers(sceneData.locations);
  scene.add(markers);
  const compass = new Compass3D();
  world.standaloneMesh("/Game/UI/HUD/Compass/Compass_SM.Compass_SM")
    .then((m) => compass.setMesh(m))
    .catch((e) => console.warn("compass mesh failed", e));
  applyGameTheme(api);
  const menu = $("menu");
  createLocationMenu(menu, sceneData.locations, (p) => flyTo(p, camera, controls));
  menu.hidden = false;
  if (import.meta.env.DEV) Object.assign(window, { __qd: { camera, controls, world, scene, renderer, compass } });

  landing.hidden = true;
  hud.hidden = false;
  const updateInfo = () => {
    info.textContent = `Speed ${controls.speed.toFixed(1)} m/s · Tint ${world.tint ? "on" : "off"} (T)` +
      (world.errors ? ` · ${world.errors} meshes failed` : "");
  };
  controls.onSpeedChange = updateInfo;
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyT") {
      world.tint = !world.tint;
      updateInfo();
    } else if (e.code === "KeyM") {
      menu.classList.toggle("collapsed");
    } else if (e.code === "KeyL") {
      markers.visible = !markers.visible;
    }
  });
  window.addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const progress = $("progress");
  const loading = world.load(sceneData, (p) => {
    progress.textContent = p.done < p.total ? `Loading meshes ${p.done}/${p.total} ${p.label}` : "";
  });
  loading.then(() => {
    progress.textContent = "";
    updateInfo();
  });
  updateInfo();

  const ray = new Raycaster();
  ray.far = 3000;
  const center = new Vector2(0, 0);
  let lastRay = 0;
  const clock = new Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    controls.update(dt);
    const now = performance.now();
    if (now - lastRay > 250) {
      lastRay = now;
      ray.setFromCamera(center, camera);
      const hit = ray.intersectObjects(world.root.children, false)[0];
      const ud = (hit?.object as Mesh | undefined)?.userData;
      zoneLabel.textContent = ud ? `${areaLabel(ud.family)} · ${ud.level}` : "";
    }
    // Markers show through walls, so only show nearby ones.
    if (markers.visible) for (const s of markers.children) s.visible = s.position.distanceTo(camera.position) < 250;
    renderer.render(scene, camera);
    compass.render(renderer, camera, dt);
  });
}

init();
