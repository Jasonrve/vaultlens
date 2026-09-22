import { PkiStore, WorkerStopped, CertificateConflict } from "./store.js";
import { PkiAdapter, PkiError, SourceChanged } from "./adapter.js";
import { normalizeSerial } from "./certificate.js";
import { setTimeout as delay } from "node:timers/promises";
export interface WorkerInput {
  id: string;
  attempt: number;
  dbPath: string;
  address: string;
  token: string;
  namespace: string;
  skipTls: boolean;
  concurrency: number;
  requestsPerSecond: number;
}
function failure(error: unknown, phase: string) {
  if (error instanceof SourceChanged)
    return { category: "source_changed", message: error.message };
  if (error instanceof CertificateConflict)
    return { category: "identity_conflict", message: error.message };
  if (error instanceof PkiError)
    return {
      category: [401, 403].includes(error.status)
        ? "permission"
        : error.status === 404
          ? "not_found"
          : error.status === 429
            ? "rate_limit"
            : phase,
      message: error.message,
    };
  return {
    category: phase,
    message:
      phase === "certificate_parse"
        ? "Certificate parsing or identity check failed"
        : "Collection operation failed",
  };
}
export async function collectPki(input: WorkerInput) {
  const store = new PkiStore(input.dbPath);
  if (!store.claim(input.id, input.attempt)) {
    store.close();
    return;
  }
  const heartbeat = setInterval(
    () => store.heartbeat(input.id, input.attempt),
    5000,
  );
  let lastRequest = 0;
  const beforeRequest = async () => {
    store.assertWorker();
    const now = Date.now();
    lastRequest = Math.max(now, lastRequest) + 1000 / input.requestsPerSecond;
    await delay(Math.max(0, lastRequest - now));
    store.assertWorker();
  };
  const adapter = new PkiAdapter(
    input.address,
    input.token,
    input.namespace,
    input.skipTls,
    beforeRequest,
  );
  const request = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let retry = 0; ; retry++) {
      store.assertWorker();
      try {
        const result = await fn();
        store.assertWorker();
        return result;
      } catch (e) {
        if (
          e instanceof WorkerStopped ||
          retry >= 3 ||
          !(e instanceof PkiError) ||
          ![429, 502, 503, 504].includes(e.status)
        )
          throw e;
        await delay(Math.min(8000, 500 * 2 ** retry));
      }
    }
  };
  const sourceUpdate = (
    sourceId: string,
    values: Record<string, string | null>,
  ) =>
    store.transaction(() => {
      // Keys are internal call-site constants, never request fields.
      store.db
        .prepare(
          `UPDATE job_sources SET ${Object.keys(values)
            .map((key) => key + "=?")
            .join(",")} WHERE jobId=? AND sourceId=?`,
        )
        .run(...Object.values(values), input.id, sourceId);
    });
  try {
    const job = store.job(input.id)!;
    await request(() => adapter.verifyToken());
    const discovered = await request(() => adapter.discover());
    const available = await request(() => adapter.allowed(discovered));
    const missing = job.sources.filter(
      (id) => !available.some((source) => source.id === id),
    );
    if (missing.length) {
      const error = new SourceChanged();
      for (const id of missing)
        sourceUpdate(id, {
          status: "failed",
          finishedAt: new Date().toISOString(),
          errorCategory: "source_changed",
          error: error.message,
        });
      throw error;
    }
    let partial = false;
    for (const id of job.sources) {
      store.assertWorker();
      const source = available.find((s) => s.id === id)!;
      store.transaction(() => store.source(source));
      sourceUpdate(id, {
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
        errorCategory: null,
        revocationError: null,
      });
      let phase = "revocation_list";
      try {
        await request(() => adapter.assertSource(source));
        let revoked: string[] | null,
          revocationError: string | null = null;
        try {
          revoked = await request(() => adapter.serials(source, true));
        } catch (e) {
          if (e instanceof PkiError && [403, 404].includes(e.status)) {
            revoked = null;
            revocationError = e.message;
          } else throw e;
        }
        sourceUpdate(id, {
          revocationMode: revoked ? "bulk_list" : "certificate_metadata",
          revocationError,
        });
        phase = "certificate_list";
        const state = store.db
          .prepare(
            "SELECT listed FROM job_sources WHERE jobId=? AND sourceId=?",
          )
          .get(job.id, id)!;
        if (!state.listed) {
          const serials = await request(() => adapter.serials(source));
          await request(() => adapter.assertSource(source));
          store.enqueue(job.id, id, serials, revoked);
        }
        const revokedSet = revoked
          ? new Set(revoked.map(normalizeSerial))
          : null;
        // Refresh every observed body so a reused serial cannot hide behind the DER cache.
        store.transaction(() =>
          store.db
            .prepare(
              "UPDATE job_items SET state='pending' WHERE jobId=? AND sourceId=? AND state='done'",
            )
            .run(job.id, id),
        );
        phase = "certificate_read";
        for (;;) {
          store.assertWorker();
          await request(() => adapter.verifyToken());
          await request(() => adapter.assertSource(source));
          const batch = store.db
            .prepare(
              "SELECT serial FROM job_items WHERE jobId=? AND sourceId=? AND state='pending' LIMIT 100",
            )
            .all(job.id, id);
          if (!batch.length) break;
          let offset = 0,
            fatal: unknown;
          const outcomes: Array<{
            raw: string;
            observation?: Awaited<ReturnType<PkiAdapter["certificate"]>>;
            error?: unknown;
          }> = [];
          await Promise.all(
            Array.from(
              { length: Math.min(input.concurrency, batch.length) },
              async () => {
                while (offset < batch.length && !fatal) {
                  const raw = String(batch[offset++].serial);
                  try {
                    normalizeSerial(raw);
                    const observation = await request(() =>
                      adapter.certificate(source, raw),
                    );
                    if (!fatal) outcomes.push({ raw, observation });
                  } catch (error) {
                    if (
                      error instanceof WorkerStopped ||
                      (error instanceof PkiError &&
                        [401, 403].includes(error.status))
                    ) {
                      fatal = error;
                      return;
                    }
                    outcomes.push({ raw, error });
                  }
                }
              },
            ),
          );
          if (fatal) throw fatal;
          // Stage at most 100 bounded responses. Discard them if source identity or access
          // changed while Vault served the batch; no record is committed before this check.
          await request(() => adapter.assertSource(source));
          for (const result of outcomes) {
            let phase = "certificate_read";
            try {
              if (result.error) throw result.error;
              const normalized = normalizeSerial(result.raw),
                observation = result.observation!;
              phase = "certificate_parse";
              store.save(
                id,
                observation.pem,
                revokedSet
                  ? revokedSet.has(normalized)
                    ? "revoked"
                    : "not_revoked"
                  : observation.revocation,
                normalized,
                () => {
                  store.db
                    .prepare(
                      "UPDATE job_items SET state='done',error=NULL,errorCategory=NULL WHERE jobId=? AND sourceId=? AND serial=?",
                    )
                    .run(job.id, id, result.raw);
                },
              );
            } catch (error) {
              if (error instanceof WorkerStopped) throw error;
              const detail = failure(error, phase);
              store.transaction(() =>
                store.db
                  .prepare(
                    "UPDATE job_items SET state='failed',error=?,errorCategory=? WHERE jobId=? AND sourceId=? AND serial=?",
                  )
                  .run(detail.message, detail.category, job.id, id, result.raw),
              );
              partial = true;
            }
          }
        }
        const failed = Number(
          store.db
            .prepare(
              "SELECT COUNT(*) AS n FROM job_items WHERE jobId=? AND sourceId=? AND state!='done'",
            )
            .get(job.id, id)!.n,
        );
        const unknown = Number(
          store.db
            .prepare(
              "SELECT COUNT(*) AS n FROM certificates WHERE sourceId=? AND revoked='unknown' AND lastSeen>=?",
            )
            .get(id, job.createdAt)!.n,
        );
        const coverage = failed
            ? "partial"
            : unknown
              ? "revocation_unknown"
              : "complete",
          now = new Date().toISOString();
        store.transaction(() => {
          store.db
            .prepare("UPDATE sources SET lastCollected=?,coverage=? WHERE id=?")
            .run(now, coverage, id);
          store.db
            .prepare(
              "UPDATE job_sources SET status=?,finishedAt=? WHERE jobId=? AND sourceId=?",
            )
            .run(coverage, now, job.id, id);
          if (!failed)
            store.db
              .prepare(
                "UPDATE certificates SET presence='not_observed' WHERE sourceId=? AND lastSeen<?",
              )
              .run(id, job.createdAt);
        });
        partial ||= failed > 0 || unknown > 0;
      } catch (e) {
        if (e instanceof WorkerStopped) throw e;
        const error = failure(e, phase);
        sourceUpdate(id, {
          status: "failed",
          finishedAt: new Date().toISOString(),
          error: error.message,
          errorCategory: error.category,
        });
        store.transaction(() =>
          store.db
            .prepare("UPDATE sources SET coverage='partial' WHERE id=?")
            .run(id),
        );
        if (e instanceof PkiError && [401, 403].includes(e.status)) throw e;
        partial = true;
      }
    }
    store.finish(
      input.id,
      input.attempt,
      partial ? "partial" : "completed",
      partial
        ? "Some records or revocation information could not be read"
        : null,
    );
  } catch (e) {
    store.finish(
      input.id,
      input.attempt,
      e instanceof WorkerStopped ||
        (e instanceof PkiError && [401, 403].includes(e.status))
        ? "paused"
        : "interrupted",
      e instanceof WorkerStopped
        ? null
        : e instanceof PkiError
          ? e.message
          : "Collection interrupted; resume with a valid Vault session",
    );
  } finally {
    clearInterval(heartbeat);
    store.close();
  }
}
if (process.send) {
  process.once("message", (input: WorkerInput) => {
    process.disconnect();
    void collectPki(input).catch(() => {
      process.exitCode = 1;
    });
  });
}
