# Queen's Domain Explorer

Free-fly through the world of **Queen's Domain** in 3D, in your browser.

**Live app:** https://smasimar.github.io/queens-domain-explorer/

> **You need your own copy of the game.** This repository and the web app contain
> no game assets. The app reads `QueensDomain-WindowsNoEditor.pak` from your disk
> and parses it inside your browser tab. Nothing is uploaded.

## How to use

1. Open the app (desktop Chrome, Edge or Firefox).
2. Select `QueensDomain-WindowsNoEditor.pak`. It is usually in
   `…\steamapps\common\QueensDomain\QueensDomain\Content\Paks\`.
3. Wait for the world to load. Converted data is cached in your browser's private
   storage (OPFS), so next time you can use **Open from local cache**.

### Controls

| Key | Action |
| --- | --- |
| Click | Capture the mouse and fly |
| W A S D | Move |
| Space / E | Up |
| C / Q / Ctrl | Down |
| Shift | Boost |
| Mouse wheel | Change speed |
| T | Toggle zone tint |
| L | Toggle altar markers |
| M | Show / hide the fast-travel menu |
| Esc | Release the mouse |

The **Fast Travel** menu (left) lists every fast-travel and save altar, grouped by
area. Click an entry to fly there. The compass (top right) is the game's own
compass sphere.

URL options: `?levels=phase1` loads only the starting area;
`?levels=100_GR,200_AQ` loads a custom list of sublevels.

## How it works

- `src/ue/` is a small TypeScript reader for the game's Unreal Engine 4.27 data:
  pak index, cooked packages (tagged properties), levels, static meshes,
  textures, materials, string tables and area data.
- `src/worker.ts` parses in a Web Worker and caches results in OPFS.
- `src/viewer/` renders with three.js: noclip camera, zone tint, HUD, compass,
  fast-travel menu. The menu uses the game's own UI font and textures, read from
  your pak at runtime.

## Development

Requires Node.js 18+ (or Deno 2).

```bash
npm install
npm run dev
```

With Deno instead of Node:

```bash
deno install
deno run -A node_modules/vite/bin/vite.js
```

Dev shortcut: set `QD_PAK_DIR` to your `…\Content\Paks` folder and open
`http://localhost:5173/?devpak` to load the pak without the file picker. This
works only on the dev server.

`scripts/` holds Deno scripts used to explore the game data, for example
`deno run --allow-read scripts/spike-pak.ts`.

### Deploy to GitHub Pages

The site is served from the `gh-pages` branch:

```bash
npm run build
git worktree add ../qde-pages gh-pages
cp -r dist/* ../qde-pages/ && cd ../qde-pages && git add -A && git commit -m "Deploy" && git push
```

## Legal

Queen's Domain and its assets belong to their respective owners. This is an
unofficial fan tool, not affiliated with or endorsed by them. Code: MIT.
