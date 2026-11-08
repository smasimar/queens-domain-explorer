import type { CollectiblePoint, LocationPoint } from "../protocol.ts";
import type { SaveProgress } from "../ue/gvas.ts";

/** Save state lookups for markers. */
export class Progress {
  private states: Set<string>;
  private flags: Set<string>;
  private teleporters: Set<string>;
  private savePoints: Set<string>;
  private items: Set<string>;
  private kills: Set<string>;

  constructor(readonly save: SaveProgress) {
    this.states = new Set(save.actorStates);
    this.flags = new Set(save.flags);
    this.teleporters = new Set(save.unlockedTeleporters);
    this.savePoints = new Set(save.savePointsVisited);
    this.items = new Set(save.itemsOwned ?? []);
    this.kills = new Set(save.enemiesKilled ?? []);
  }

  /** true = collected/opened/read, false = not yet, null = the save cannot tell. */
  collected(p: CollectiblePoint): boolean | null {
    if (p.enemy) return this.kills.has(p.enemy);
    if (p.category === "notes") return p.noteKey ? this.flags.has(`ReadNote_${p.noteKey}`) : null;
    // A few unique pickups have no save GUID: the save only records the item
    // (owned, used up or sold). Each is the only placement of its item.
    if (!p.guids.length) return p.item ? this.items.has(p.item) : null;
    if (p.guids.some((g) => this.states.has(g))) return true;
    // Switch-opened secret doors: the switches save their state, the door does not.
    if (p.activators?.length) {
      return p.activators.filter((a) => a.some((g) => this.states.has(g))).length >= (p.required ?? 1);
    }
    return false;
  }

  unlocked(p: LocationPoint): boolean {
    return p.kind === "fasttravel" ? this.teleporters.has(p.asset) : this.savePoints.has(p.asset);
  }
}
