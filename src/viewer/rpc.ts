import type { WorkerApi } from "../protocol.ts";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** Promise-based proxy to the parser worker. */
export function createWorkerApi(): WorkerApi {
  const worker = new Worker(new URL("../worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, Pending>();
  let next = 1;
  worker.onmessage = (ev) => {
    const { id, result, error } = ev.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(result);
  };
  return new Proxy({} as WorkerApi, {
    get: (_t, method: string) => (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        const id = next++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, method, args });
      }),
  });
}
