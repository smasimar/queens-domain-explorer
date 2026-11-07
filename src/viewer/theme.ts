import type { UiImage, WorkerApi } from "../protocol.ts";

async function imageUrl(img: UiImage | null): Promise<string | null> {
  if (!img) return null;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const px = new Uint8ClampedArray(img.rgba.byteLength);
  px.set(img.rgba);
  const data = new ImageData(px, img.width, img.height);
  c.getContext("2d")!.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  return blob ? URL.createObjectURL(blob) : null;
}

async function addFont(family: string, data: Uint8Array | null, weight: string): Promise<boolean> {
  if (!data) return false;
  try {
    const face = new FontFace(family, data.slice().buffer as ArrayBuffer, { weight });
    await face.load();
    document.fonts.add(face);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply the game's own UI font and stone textures, read from the user's pak.
 * Nothing is bundled with the app; without the pak the default theme stays.
 */
export async function applyGameTheme(api: WorkerApi): Promise<void> {
  try {
    const ui = await api.uiAssets();
    const root = document.documentElement.style;
    const [frame, panel, dot] = await Promise.all([
      imageUrl(ui.images.frame),
      imageUrl(ui.images.panel),
      imageUrl(ui.images.dot),
    ]);
    if (frame) root.setProperty("--qd-frame", `url("${frame}")`);
    if (panel) root.setProperty("--qd-panel", `url("${panel}")`);
    if (dot) root.setProperty("--qd-dot", `url("${dot}")`);
    const fonts = await Promise.all([
      addFont("QD Game", ui.fonts.regular, "400"),
      addFont("QD Game", ui.fonts.light, "300"),
    ]);
    if (frame && panel) document.body.classList.add("qd-theme");
    if (fonts[0]) document.body.classList.add("qd-font");
  } catch (e) {
    console.warn("Game UI theme unavailable", e);
  }
}
