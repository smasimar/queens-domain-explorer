import type { CategoryCount } from "./collectibles.ts";
import { SAVE_DIR_HINT, type SaveSlot, type SaveState } from "./savefolder.ts";
import { CATEGORIES, RANGE, type Settings } from "./settings.ts";

export type Tab = "travel" | "markers";

/** Left menu with two tabs. Returns the tab bodies. */
export function createMenu(el: HTMLElement): {
  travel: HTMLElement;
  markers: HTMLElement;
  searchBox: HTMLElement;
  results: HTMLElement;
  show: (t: Tab) => void;
  /** While searching, the results replace the tab bodies. */
  searching: (on: boolean) => void;
} {
  el.innerHTML = `
    <div class="menu-head">
      <div class="menu-tabs" role="tablist">
        <button class="menu-tab" data-tab="travel" role="tab">Wing Altars</button>
        <button class="menu-tab" data-tab="markers" role="tab">Markers</button>
      </div>
      <kbd>M</kbd>
    </div>
    <div class="menu-search"></div>
    <div class="menu-list" data-body="travel"></div>
    <div class="menu-list markers" data-body="markers" hidden></div>
    <div class="menu-list results" data-results hidden></div>`;
  let current: Tab = "travel";
  let inSearch = false;
  const layout = () => {
    for (const b of el.querySelectorAll<HTMLElement>("[data-body]")) b.hidden = inSearch || b.dataset.body !== current;
    el.querySelector<HTMLElement>("[data-results]")!.hidden = !inSearch;
  };
  const show = (t: Tab) => {
    current = t;
    for (const b of el.querySelectorAll<HTMLElement>(".menu-tab")) b.classList.toggle("active", b.dataset.tab === t);
    layout();
    try {
      localStorage.setItem("qd-tab", t);
    } catch { /* ignore */ }
  };
  for (const b of el.querySelectorAll<HTMLElement>(".menu-tab")) b.onclick = () => show(b.dataset.tab as Tab);
  let initial: Tab = "travel";
  try {
    if (localStorage.getItem("qd-tab") === "markers") initial = "markers";
  } catch { /* ignore */ }
  show(initial);
  return {
    travel: el.querySelector<HTMLElement>('[data-body="travel"]')!,
    markers: el.querySelector<HTMLElement>('[data-body="markers"]')!,
    searchBox: el.querySelector<HTMLElement>(".menu-search")!,
    results: el.querySelector<HTMLElement>("[data-results]")!,
    show,
    searching: (on) => {
      if (on === inSearch) return;
      inSearch = on;
      layout();
    },
  };
}

export interface MarkersModel {
  settings: Settings;
  counts(): Map<string, CategoryCount>;
  save: SaveState;
  selected: SaveSlot | null;
  error: string | null;
  busy: boolean;
  /** Settings changed; `rerender` false keeps the panel DOM (e.g. while dragging the slider). */
  onSettings(rerender?: boolean): void;
  onPickFolder(): void;
  onForget(): void;
  onSelect(slot: SaveSlot): void;
}

function fmtPlayTime(s: number | null): string {
  if (s === null) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "unknown date";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function slotLabel(name: string): string {
  const m = /^World(\d+)(?:_Suspend_(\d+))?$/i.exec(name);
  if (!m) return name;
  return `Slot ${Number(m[1]) + 1}` + (m[2] !== undefined ? ` · suspend ${Number(m[2]) + 1}` : "");
}

function row(cls: string, html: string, on: () => void, pressed?: boolean): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `opt ${cls}`;
  b.innerHTML = html;
  if (pressed !== undefined) {
    b.setAttribute("aria-pressed", String(pressed));
    b.classList.toggle("on", pressed);
  }
  b.onclick = on;
  return b;
}

/** A panel section; `extra` (e.g. a small toggle) goes on the right of the heading line. */
function section(title: string, extra?: HTMLElement | null): HTMLElement {
  const s = document.createElement("section");
  const head = document.createElement("div");
  head.className = "sec-head";
  const h = document.createElement("h3");
  h.textContent = title;
  head.appendChild(h);
  if (extra) {
    extra.classList.add("inline");
    head.appendChild(extra);
  }
  s.appendChild(head);
  return s;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Markers tab: display toggles, range, per-category toggles with counts, save folder. */
export function renderMarkersPanel(el: HTMLElement, m: MarkersModel): void {
  const s = m.settings;
  const scroll = el.scrollTop;
  el.innerHTML = "";
  const change = (fn: () => void) => () => {
    fn();
    m.onSettings();
  };

  const disp = section("Display");
  disp.append(
    row("toggle", `<i></i><span>Zone tint</span><kbd>T</kbd>`, change(() => (s.tint = !s.tint)), s.tint),
  );
  const range = document.createElement("label");
  range.className = "opt range";
  range.innerHTML = `<span>Range</span><input type="range" min="${RANGE.min}" max="${RANGE.max}" step="${RANGE.step}"><em></em>`;
  const input = range.querySelector("input")!;
  const out = range.querySelector("em")!;
  input.value = String(s.range);
  out.textContent = `${s.range} m`;
  input.oninput = () => {
    s.range = Number(input.value);
    out.textContent = `${s.range} m`;
    m.onSettings(false);
  };
  disp.append(range);
  el.append(disp);

  const hasSave = m.save.kind === "ready" && !!m.selected;
  const marks = section(
    "Landmarks",
    hasSave
      ? row("toggle", `<i></i><span>Show locked</span>`, change(() => (s.showLocked = !s.showLocked)), s.showLocked)
      : null,
  );
  marks.append(
    row("toggle", `<i></i><span>Wing Altars</span>`, change(() => (s.teleporters = !s.teleporters)), s.teleporters),
    row("toggle", `<i></i><span>Crystal Monuments</span>`, change(() => (s.saves = !s.saves)), s.saves),
  );
  el.append(marks);

  const cats = section(
    "Collectibles",
    hasSave
      ? row(
        "toggle",
        `<i></i><span>Show collected</span>`,
        change(() => (s.showCollected = !s.showCollected)),
        s.showCollected,
      )
      : null,
  );
  const counts = m.counts();
  for (const c of CATEGORIES) {
    const n = counts.get(c.id) ?? { total: 0, collected: 0 };
    const count = hasSave ? `${n.collected}/${n.total}` : `${n.total}`;
    const b = row(
      "toggle cat",
      `<i style="--c:${c.color}"></i><span>${c.label}</span><em>${count}</em>`,
      change(() => (s.cats[c.id] = !s.cats[c.id])),
      s.cats[c.id],
    );
    cats.append(b);
  }
  el.append(cats);

  const save = section("Save");
  if (m.busy) {
    save.insertAdjacentHTML("beforeend", `<p class="menu-note">Reading save…</p>`);
  } else if (m.save.kind === "ready") {
    for (const slot of m.save.slots) {
      const b = row(
        "slot",
        `<i></i><span>${esc(slotLabel(slot.name))}<small>${esc(fmtDate(slot.progress.lastSaveTime))} · ${
          fmtPlayTime(slot.progress.playTimeSeconds)
        }</small></span>`,
        () => m.onSelect(slot),
      );
      b.classList.toggle("active", slot === m.selected);
      save.append(b);
    }
    save.append(
      row("action", `<span>Select save files</span>`, m.onPickFolder),
      row("action", `<span>Forget save</span>`, m.onForget),
    );
    save.insertAdjacentHTML(
      "beforeend",
      `<p class="menu-note">The app keeps a copy of these saves. After you play, select them again or drop them on the page.</p>`,
    );
  } else {
    save.append(row("action primary", `<span>Select save files</span>`, m.onPickFolder));
    save.insertAdjacentHTML(
      "beforeend",
      `<p class="menu-note">Grey out what you already collected. Pick <code>World0.sav</code> (add the <code>_Suspend</code> saves to switch between them) in <code>${esc(SAVE_DIR_HINT)}</code>, or drop them on the page. They are read in this tab only.</p>`,
    );
  }
  if (m.error) save.insertAdjacentHTML("beforeend", `<p class="menu-note error">${esc(m.error)}</p>`);
  el.append(save);
  el.scrollTop = scroll;
}
