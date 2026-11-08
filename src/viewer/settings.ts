import type { CollectibleCategory } from "../protocol.ts";

export interface CategoryInfo {
  id: CollectibleCategory;
  label: string;
  color: string;
  on: boolean;
}

/** Collectible categories in menu order, with their ring colour and default visibility. */
export const CATEGORIES: CategoryInfo[] = [
  { id: "weapons", label: "Main Weapons", color: "#f0c850", on: true },
  { id: "subweapons", label: "Throwing Weapons", color: "#f08a4b", on: true },
  { id: "accessories", label: "Accessories", color: "#c98cf0", on: true },
  { id: "eggs", label: "Orbewa Eggs", color: "#f4f1de", on: true },
  { id: "skulls", label: "Strange Skulls", color: "#9fb4bd", on: true },
  { id: "keys", label: "Keys", color: "#ffe066", on: true },
  { id: "health", label: "Meals", color: "#ff6b6b", on: true },
  { id: "upgrades", label: "Other upgrades", color: "#4fd8e8", on: true },
  { id: "treasure", label: "Treasure", color: "#f0a020", on: true },
  { id: "chests", label: "Chests", color: "#c08850", on: true },
  { id: "doors", label: "Secret doors", color: "#7fa8ff", on: true },
  { id: "notes", label: "Notes", color: "#d8c8a0", on: false },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export interface Settings {
  tint: boolean;
  teleporters: boolean;
  saves: boolean;
  /** Show Wing Altars / Crystal Monuments that the loaded save has not unlocked. */
  showLocked: boolean;
  /** Show collected items greyed out (off: hide them). */
  showCollected: boolean;
  /** Marker draw range in metres. */
  range: number;
  cats: Record<CollectibleCategory, boolean>;
}

const KEY = "qd-settings";
export const RANGE = { min: 25, max: 1500, step: 25 };

function defaults(): Settings {
  return {
    tint: true,
    teleporters: true,
    saves: true,
    showLocked: false,
    showCollected: true,
    range: 250,
    cats: Object.fromEntries(CATEGORIES.map((c) => [c.id, c.on])) as Settings["cats"],
  };
}

export function loadSettings(): Settings {
  const s = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    for (const k of ["tint", "teleporters", "saves", "showLocked", "showCollected"] as const) {
      if (typeof raw[k] === "boolean") s[k] = raw[k]!;
    }
    if (typeof raw.range === "number") s.range = Math.min(RANGE.max, Math.max(RANGE.min, raw.range));
    for (const c of CATEGORIES) if (typeof raw.cats?.[c.id] === "boolean") s.cats[c.id] = raw.cats[c.id];
  } catch { /* storage unavailable: defaults */ }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}
