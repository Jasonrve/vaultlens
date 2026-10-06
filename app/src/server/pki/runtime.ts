import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PkiStore } from "./store.js";
import type { WorkerInput } from "./worker.js";
export function launchCollection(input: Omit<WorkerInput, "attempt">) {
  const store = new PkiStore(input.dbPath);
  const attempt = store.dispatch(
    input.id,
    input.concurrency,
    input.requestsPerSecond,
  );
  store.close();
  const fail = () => {
    const s = new PkiStore(input.dbPath);
    try {
      s.finish(
        input.id,
        attempt,
        "interrupted",
        "Collection process exited; resume with a valid session",
      );
    } finally {
      s.close();
    }
  };
  try {
    let worker = fileURLToPath(new URL("./worker.js", import.meta.url));
    if (!existsSync(worker))
      worker = fileURLToPath(new URL("./worker.ts", import.meta.url));
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (/TOKEN|SECRET|PASSWORD/.test(key)) delete env[key];
    const child = fork(worker, [], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env,
    });
    const s = new PkiStore(input.dbPath);
    s.db
      .prepare("UPDATE jobs SET pid=? WHERE id=? AND attempt=?")
      .run(child.pid ?? null, input.id, attempt);
    s.close();
    child.once("error", fail);
    child.once("exit", fail);
    child.send({ ...input, attempt }, (error) => {
      if (error) fail();
    });
    child.unref();
  } catch {
    fail();
  }
}
