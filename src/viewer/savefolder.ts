import { readSaveProgress, type SaveProgress } from "../ue/gvas.ts";

/** One progress save. */
export interface SaveSlot {
  /** File name without .sav, e.g. "World0_Suspend_1". */
  name: string;
  progress: SaveProgress;
  bytes: Uint8Array;
}

export type SaveState = { kind: "none" } | { kind: "ready"; slots: SaveSlot[] };

export const SAVE_DIR_HINT = "%LOCALAPPDATA%\\QueensDomain\\Saved\\SaveGames\\<SteamID>";
/**
 * OPFS folder that keeps copies of the picked saves. Chrome blocks folder handles
 * under %LOCALAPPDATA%, so the app cannot re-read the game's folder by itself.
 */
const COPY_DIR = "qd-saves";

function slotFromBytes(name: string, bytes: Uint8Array): SaveSlot | null {
  try {
    return { name: name.replace(/\.sav$/i, ""), progress: readSaveProgress(bytes), bytes };
  } catch {
    return null;
  }
}

/** Newest first. */
function sortSlots(slots: SaveSlot[]): SaveSlot[] {
  return slots.sort((a, b) => (b.progress.lastSaveTime ?? "").localeCompare(a.progress.lastSaveTime ?? ""));
}

async function copyDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(COPY_DIR, { create });
}

async function writeCopies(slots: SaveSlot[]): Promise<void> {
  try {
    await forgetSave();
    const dir = await copyDir(true);
    for (const s of slots) {
      const w = await (await dir.getFileHandle(`${s.name}.sav`, { create: true })).createWritable();
      await w.write(s.bytes as unknown as ArrayBuffer);
      await w.close();
    }
  } catch (e) {
    console.warn("Could not store the save copies", e);
  }
}

/** Load the stored save copies (no prompt). */
export async function restoreSave(): Promise<SaveState> {
  try {
    const dir = await copyDir(false);
    const slots: SaveSlot[] = [];
    // deno-lint-ignore no-explicit-any
    for await (const entry of (dir as any).values() as AsyncIterable<FileSystemHandle>) {
      if (entry.kind !== "file") continue;
      const f = await (entry as FileSystemFileHandle).getFile();
      const s = slotFromBytes(f.name, new Uint8Array(await f.arrayBuffer()));
      if (s) slots.push(s);
    }
    if (slots.length) return { kind: "ready", slots: sortSlots(slots) };
  } catch { /* no copies yet */ }
  return { kind: "none" };
}

/** Read saves from picked or dropped files, and keep copies for the next visit. */
export async function savesFromFiles(files: File[]): Promise<SaveState> {
  const slots: SaveSlot[] = [];
  for (const f of files) {
    // Any progress save is fine (renamed copies too); skip backups and settings.
    if (!/\.sav$/i.test(f.name) || /_backup\.sav$/i.test(f.name) || f.size > 64 << 20) continue;
    const s = slotFromBytes(f.name, new Uint8Array(await f.arrayBuffer()));
    if (s) slots.push(s);
  }
  if (!slots.length) throw new Error("No progress save in the selected files. Pick World0.sav (or its suspend saves).");
  sortSlots(slots);
  await writeCopies(slots);
  return { kind: "ready", slots };
}

/** Let the user pick one or more save files (needs a click). */
export async function pickSaveFiles(): Promise<SaveState> {
  const files = await new Promise<File[]>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".sav";
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => reject(new DOMException("cancelled", "AbortError"));
    input.click();
  });
  return savesFromFiles(files);
}

export async function forgetSave(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(COPY_DIR, { recursive: true });
  } catch { /* none */ }
}
