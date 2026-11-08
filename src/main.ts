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
  type Sprite,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { clearAllCaches, readLastNamespace } from "./cache.ts";
import type { CollectiblePoint } from "./protocol.ts";
import { CollectibleLayer, describe, pickNearCentre } from "./viewer/collectibles.ts";
import { Compass3D } from "./viewer/compass.ts";
import { NoclipControls } from "./viewer/controls.ts";
import {
  createMarkers,
  describeLocation,
  flyTo,
  flyToSpot,
  LANDMARK,
  locationVisible,
  renderLocationList,
  updateMarkers,
} from "./viewer/locations.ts";
import { createMenu, type MarkersModel, renderMarkersPanel } from "./viewer/menu.ts";
import { Progress } from "./viewer/progress.ts";
import {
  forgetSave,
  pickSaveFiles,
  restoreSave,
  type SaveSlot,
  type SaveState,
  savesFromFiles,
} from "./viewer/savefolder.ts";
import { Search, type SearchEntry } from "./viewer/search.ts";
import { CATEGORY_BY_ID, loadSettings, saveSettings } from "./viewer/settings.ts";
import { createWorkerApi } from "./viewer/rpc.ts";
import { applyGameTheme } from "./viewer/theme.ts";
import { World } from "./viewer/world.ts";
import { ALL_LEVELS, areaLabel, learnAreaNames, PHASE1_LEVELS, zoneFamily } from "./viewer/zones.ts";
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

  const settings = loadSettings();
  const world = new World(api, renderer);
  world.tint = settings.tint;
  scene.add(world.root);
  learnAreaNames(sceneData.locations.flatMap((g) => g.points.map((p) => ({ level: p.level, area: g.area }))));
  const markers = createMarkers(sceneData.locations);
  scene.add(markers);
  const collectibles = new CollectibleLayer(api, sceneData.collectibles);
  scene.add(collectibles.root);
  const compass = new Compass3D();
  world.standaloneMesh("/Game/UI/HUD/Compass/Compass_SM.Compass_SM")
    .then((m) => compass.setMesh(m))
    .catch((e) => console.warn("compass mesh failed", e));
  applyGameTheme(api);

  // ---- menu: Wing Altars + Markers tabs ----
  const menu = $("menu");
  const tabs = createMenu(menu);
  let progress: Progress | null = null;
  const renderTravel = () =>
    renderLocationList(
      tabs.travel,
      sceneData.locations,
      (p) => flyTo(p, camera, controls),
      (p) => locationVisible(p, settings, progress),
    );
  const model: MarkersModel = {
    settings,
    counts: () => collectibles.counts(),
    save: { kind: "none" },
    selected: null,
    error: null,
    busy: false,
    onSettings: (rerender = true) => {
      saveSettings(settings);
      if (world.tint !== settings.tint) world.tint = settings.tint;
      updateInfo();
      if (!rerender) return;
      renderTravel();
      renderPanel();
    },
    onPickFolder: () => loadSave(pickSaveFiles),
    onForget: async () => {
      await forgetSave();
      setSave({ kind: "none" });
    },
    onSelect: (slot) => useSlot(slot),
  };
  const renderPanel = () => renderMarkersPanel(tabs.markers, model);

  // ---- search: collectibles and landmarks by name ----
  const search = new Search(tabs.searchBox, tabs.results, tabs.searching);
  const entries: SearchEntry[] = [];
  for (const s of collectibles.all()) {
    const p = s.userData.point as CollectiblePoint;
    const cat = CATEGORY_BY_ID.get(p.category);
    const one = cat?.one ?? p.category;
    const fam = zoneFamily(p.level);
    const opens = p.category === "chests" || p.category === "doors";
    const foe = p.category === "enemies";
    entries.push({
      name: p.count > 1 ? `${p.name} ×${p.count}` : p.name,
      detail: [one !== p.name ? one : null, p.hiddenBy, areaLabel(fam)].filter(Boolean).join(" · "),
      color: cat?.color ?? "#fff",
      kind: "item",
      keywords: `${cat?.label ?? ""} ${p.level}`,
      state: () => {
        if (!progress) return null;
        const c = s.userData.collected as boolean | null;
        if (c === null) return null;
        return { done: c, text: opens ? (c ? "opened" : "not opened") : foe ? (c ? "killed" : "not killed") : c ? "collected" : "not collected" };
      },
      go: () => {
        // Make sure the result is drawn: its category on, collected ones shown, in range.
        let changed = false;
        if (!settings.cats[p.category]) settings.cats[p.category] = changed = true;
        if (s.userData.collected === true && !settings.showCollected) settings.showCollected = changed = true;
        if (settings.range < 30) {
          settings.range = 30;
          changed = true;
        }
        if (changed) model.onSettings();
        flyToSpot(s.position, camera, controls);
      },
    });
  }
  for (const g of sceneData.locations) {
    for (const p of g.points) {
      const name = p.kind === "fasttravel" ? p.name : p.name || g.area;
      entries.push({
        name,
        detail: [LANDMARK[p.kind], name !== g.area ? g.area : null].filter(Boolean).join(" · "),
        color: "",
        kind: p.kind,
        keywords: p.level ?? "",
        state: () => (progress && !progress.unlocked(p) ? { text: "not unlocked", done: false } : null),
        go: () => {
          if (progress && !progress.unlocked(p) && !settings.showLocked) {
            settings.showLocked = true;
            model.onSettings();
          }
          flyTo(p, camera, controls);
        },
      });
    }
  }
  search.setEntries(entries);

  const useSlot = (slot: SaveSlot | null) => {
    model.selected = slot;
    progress = slot ? new Progress(slot.progress) : null;
    collectibles.setProgress(progress);
    renderTravel();
    renderPanel();
    search.render();
  };
  const setSave = (state: SaveState) => {
    model.save = state;
    model.busy = false;
    useSlot(state.kind === "ready" ? state.slots[0] : null);
  };
  async function loadSave(get: () => Promise<SaveState>) {
    model.error = null;
    model.busy = true;
    renderPanel();
    try {
      setSave(await get());
    } catch (e) {
      model.busy = false;
      // The user closing the folder picker is not an error.
      if ((e as Error).name !== "AbortError") model.error = (e as Error).message;
      renderPanel();
    }
  }
  renderTravel();
  renderPanel();
  menu.hidden = false;
  loadSave(restoreSave);
  // Drop .sav files anywhere on the page.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) loadSave(() => savesFromFiles(files));
  });
  if (import.meta.env.DEV) {
    Object.assign(window, { __qd: { camera, controls, world, scene, renderer, compass, collectibles, model } });
  }

  landing.hidden = true;
  hud.hidden = false;
  const updateInfo = () => {
    info.textContent = `Speed ${controls.speed.toFixed(1)} m/s` +
      (world.errors ? ` · ${world.errors} meshes failed` : "");
  };
  controls.onSpeedChange = updateInfo;
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.code === "KeyT") {
      settings.tint = !settings.tint;
      model.onSettings();
    } else if (e.code === "KeyM") {
      menu.classList.toggle("collapsed");
    } else if (e.code === "KeyF") {
      e.preventDefault();
      document.exitPointerLock();
      menu.classList.remove("collapsed");
      search.focus();
    } else if (e.code === "KeyL") {
      const on = !(settings.teleporters || settings.saves);
      settings.teleporters = settings.saves = on;
      model.onSettings();
    }
  });
  window.addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const progressEl = $("progress");
  const loading = world.load(sceneData, (p) => {
    progressEl.textContent = p.done < p.total ? `Loading meshes ${p.done}/${p.total} ${p.label}` : "";
  });
  loading.then(() => {
    world.assignShellFamilies().catch((e) => console.warn("shell families failed", e));
    progressEl.textContent = "";
    updateInfo();
  });
  updateInfo();

  const hover = $("hover");
  // Zone label: the level of the surface below the camera (above it if nothing is below).
  const ray = new Raycaster();
  ray.far = 3000;
  const down = new Vector3(0, -1, 0), up = new Vector3(0, 1, 0);
  let lastRay = 0;
  const clock = new Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    controls.update(dt);
    const now = performance.now();
    if (now - lastRay > 250) {
      lastRay = now;
      ray.set(camera.position, down);
      let hit = ray.intersectObjects(world.root.children, false)[0];
      if (!hit) {
        ray.set(camera.position, up);
        hit = ray.intersectObjects(world.root.children, false)[0];
      }
      const ud = (hit?.object as Mesh | undefined)?.userData;
      zoneLabel.textContent = ud ? `${areaLabel(ud.family)} · ${ud.level}` : "";
      const item = collectibles.pick(camera, innerWidth, innerHeight);
      const place = pickNearCentre(markers.children as Sprite[], camera, innerWidth, innerHeight);
      hover.textContent = place && (!item || place.d2 < item.d2)
        ? describeLocation(place.sprite, progress)
        : item
        ? describe(item.sprite, !!progress)
        : "";
    }
    // Markers show through walls, so only show nearby ones.
    updateMarkers(markers, camera, settings, progress);
    collectibles.update(camera, settings);
    renderer.render(scene, camera);
    compass.render(renderer, camera, dt);
  });
}

init();
