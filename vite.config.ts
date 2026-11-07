import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev only: serve the local game pak at /@pak/<file> with HTTP Range support,
 * when QD_PAK_DIR points at ...\QueensDomain\Content\Paks. Never part of a build.
 */
function devPak(): Plugin {
  return {
    name: "dev-pak",
    apply: "serve",
    configureServer(server) {
      const dir = process.env.QD_PAK_DIR;
      if (!dir) return;
      server.middlewares.use("/@pak/", (req, res) => {
        const name = decodeURIComponent((req.url ?? "").replace(/^\//, "").split("?")[0]);
        if (!/^[\w.-]+\.pak$/.test(name)) return void res.writeHead(404).end();
        const path = join(dir, name);
        const size = statSync(path).size;
        const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
        if (!m) {
          res.writeHead(200, { "Content-Length": size, "Accept-Ranges": "bytes" });
          return void createReadStream(path).pipe(res);
        }
        const start = Number(m[1]);
        const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": end - start + 1,
          "Accept-Ranges": "bytes",
        });
        createReadStream(path, { start, end }).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [devPak()],
  // Deno's fs watcher crashes on short-lived atomic-write temp files; poll instead.
  server: { watch: { usePolling: true, interval: 300, ignored: ["**/*.tmp.*", "**/node_modules/**", "**/.git/**"] } },
  worker: { format: "es" },
  build: { target: "es2022" },
});
