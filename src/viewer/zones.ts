import { Color } from "three";

/** Phase 1: the starting area (Isle of Neasied surface + GR). */
export const PHASE1_LEVELS = ["050_Ocean", "070_UpperShell", "100_GR", "130_GR_outerisles", "140_GR_ShopIsleOnly", "VideoConfigMap"];

/**
 * All world sublevels (cutscene/intro/menu maps excluded). 900_SipehaWorld (the
 * final boss arena and its water) is left out too: it has no pickups and the
 * player only gets there during the boss fight.
 */
export const ALL_LEVELS = [
  "000_Shared_Base_Lighting", "050_Ocean", "060_Ocean_Shadow", "070_UpperShell",
  "100_GR", "110_GR_dungeon", "120_GR_goldenroom", "125_GR_CubeHall", "130_GR_outerisles", "140_GR_ShopIsleOnly", "VideoConfigMap",
  "200_AQ", "210_AQ_underground", "300_LIB", "310_LIB_exterior", "320_LIB_basement",
  "400_MAUS_entrance", "420_MAUS_mid", "450_MAUS_darkmaze", "500_AUT", "510_AUT_droptunnel",
  "600_Castle", "610_Castle_Ext", "700_SZ_GR", "710_SZ_AQ", "720_SZ_LIB", "730_HOD", "740_SZ_Prison",
  "750_SZ_MAUS2", "760_SZ_AUT", "760_Dekanima", "770_SZ_Swamp", "775_JigekiTemple", "780_SZ_Depths", "790_SG",
  "800_FinalZone", "990_B33sment",
];

/** Zone family code for a sublevel name. */
export function zoneFamily(level: string): string {
  if (level === "VideoConfigMap") return "GR"; // the vendor (shop) island
  const m = /^(\d{3})_(.+)$/.exec(level);
  if (!m) return level;
  const n = Number(m[1]);
  const rest = m[2];
  if (n < 70) return n === 0 ? "Shared" : "Ocean";
  if (n < 100) return "UpperShell";
  if (n >= 700 && n < 800) return rest.replace(/^SZ_/, "SZ ").replace(/_/g, " ");
  const byHundred: Record<number, string> = { 1: "GR", 2: "AQ", 3: "LIB", 4: "MAUS", 5: "AUT", 6: "Castle", 8: "Final" };
  return byHundred[Math.floor(n / 100)] ?? rest.replace(/_/g, " ");
}

const familyColors = new Map<string, Color>();
const FIXED: Record<string, string> = {
  UpperShell: "#d9b26f", GR: "#6fbf73", AQ: "#4fa3e0", LIB: "#b07fe0", MAUS: "#e06f6f",
  AUT: "#e0a04f", Castle: "#9aa3b5", Ocean: "#4fd0c8", Final: "#f0e060", Shared: "#ffffff",
};

/** Stable, distinct tint per family. */
export function familyColor(family: string): Color {
  let c = familyColors.get(family);
  if (!c) {
    if (FIXED[family]) c = new Color(FIXED[family]);
    else {
      let h = 0;
      for (const ch of family) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      c = new Color().setHSL(((h % 360) / 360 + 0.618) % 1, 0.65, 0.6);
    }
    familyColors.set(family, c);
  }
  return c;
}

/** In-game area names (from the game's area data folders) for zone families. */
const AREA_NAMES: Record<string, string> = {
  UpperShell: "Isle of Neasied",
  GR: "Isle of Neasied",
  AQ: "Obmuer Temple",
  LIB: "Tower of Knowledge",
  MAUS: "Deimpo Mausoleum",
  AUT: "Ancient World",
  Castle: "Siraatsu Castle",
  // The game has no area name for these zones (no Wing Altar or Crystal Monument
  // names them). These labels come from in-game text:
  "SZ AQ": "Obmuer Temple Vault", // Treasure Hunter's Note III: "this vault"
  "SZ LIB": "Tower of Knowledge Depths",
  "SZ MAUS2": "Puwema's Temple", // unused string pt_areaname; Josami guard Puwema's temple
  HOD: "Primeval Shrine", // the Okbujo shrine: "Primeval Shrine Engraving"
  Dekanima: "Dekanima",
  JigekiTemple: "Jigeki's Temple", // Muagyo's Journey notes
  Final: "Final Zone",
  B33sment: "B33sment",
};

/**
 * Area names learned from the Wing Altar / Crystal Monument data: each landmark's
 * sublevel belongs to its area, so the sublevel's zone family gets that name.
 * This names the secret zones (e.g. 760_SZ_AUT is Record of Sin).
 */
const learnedNames = new Map<string, string>();

export function learnAreaNames(points: { level: string | null; area: string }[]): void {
  const votes = new Map<string, Map<string, number>>();
  for (const p of points) {
    if (!p.level) continue;
    const fam = zoneFamily(p.level);
    const v = votes.get(fam) ?? new Map<string, number>();
    v.set(p.area, (v.get(p.area) ?? 0) + 1);
    votes.set(fam, v);
  }
  for (const [fam, v] of votes) {
    if (AREA_NAMES[fam]) continue; // the fixed names cover the main areas
    // A sublevel can hold landmarks of two areas (740_SZ_Prison: Underworld and
    // Forgotten Dungeon); name both, most landmarks first.
    learnedNames.set(fam, [...v].sort((a, b) => b[1] - a[1]).map(([area]) => area).join(" / "));
  }
}

/** HUD label for a zone family, e.g. "Ancient World (AUT)". */
export function areaLabel(family: string): string {
  const name = AREA_NAMES[family] ?? learnedNames.get(family);
  return name && name !== family ? `${name} (${family})` : family;
}
