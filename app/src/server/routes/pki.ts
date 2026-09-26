import { compareSerials } from "../pki/comparison.js";
import { parseCertificate } from "../pki/certificate.js";
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { resolve } from "node:path";
import { findIssuer } from "../pki/issuer.js";
import { config } from "../config/index.js";
import { PkiAdapter, PkiError } from "../pki/adapter.js";
import { PkiStore } from "../pki/store.js";
import { validateQuery } from "../pki/query.js";
import { launchCollection } from "../pki/runtime.js";
import type { PkiSource } from "../../shared/pki.js";
import { collectionSettings } from "../pki/settings.js";
import { batchAction, batchRefs, batchRef, previewBatch, executeBatchItem } from "../pki/batch.js";
import { pkiBatchLimit, type PkiBatchRef } from "../../shared/pkiBatch.js";
const limits = collectionSettings();
const router = Router();
const dbPath = resolve(
  process.env["VAULTLENS_PKI_DB_PATH"] || "data/pki-certificates.sqlite",
);
const namespace = process.env["VAULTLENS_PKI_NAMESPACE"] || "";
// A deployment is bound to its configured Vault/namespace; requests cannot inject a target URL.
let instance: PkiStore | undefined;
const store = () => (instance ??= new PkiStore(dbPath));
type Context = { adapter: PkiAdapter; token: string; sources: PkiSource[]; admin: boolean };
const contexts = new WeakMap<Request, Context>();
router.use(async (req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : req.cookies?.vault_token;
    if (typeof token !== "string" || !token)
      throw new PkiError(401, "Authentication required");
    const adapter = new PkiAdapter(
      config.vaultAddr,
      token,
      namespace,
      config.vaultSkipTlsVerify,
    );
    const tokenInfo = await adapter.verifyToken();
    const policies = [...(tokenInfo?.policies ?? []), ...(tokenInfo?.identity_policies ?? [])];
    const admin = policies.includes("root") || policies.includes("vaultlens-admin");
    const sources = await adapter.allowed(await adapter.discover());
    for (const source of sources) store().source(source);
    contexts.set(req, { adapter, token, sources, admin });
    next();
  } catch (e) {
    next(e);
  }
});
const wrap =
  (fn: (req: Request, res: Response, ctx: Context) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve()
      .then(() => fn(req, res, contexts.get(req)!))
      .catch(next);
function authorized(ids: unknown, ctx: Context): string[] {
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    ids.some((x) => typeof x !== "string")
  )
    throw new PkiError(400, "Invalid source selection");
  const result = [...new Set(ids)] as string[];
  if (result.some((id) => !ctx.sources.some((s) => s.id === id)))
    throw new PkiError(
      403,
      "Selected source is not authorized or no longer exists",
    );
  return result;
}
router.get(
  "/sources",
  wrap((_req, res, ctx) => {
    res.json({
      sources: store().sources(ctx.sources.map((s) => s.id)),
      namespace,
    });
  }),
);
router.get("/sources/:id/check", wrap(async (req, res, ctx) => {
  const [id] = authorized([req.params.id], ctx);
  const source = ctx.sources.find((s) => s.id === id)!;
  const serials = await ctx.adapter.serials(source);
  // Revalidate identity/access after LIST, including empty-list 404 responses.
  await ctx.adapter.assertSource(source);
  const local = store().db.prepare("SELECT serial FROM certificates WHERE sourceId=?")
    .all(id) as { serial: string }[];
  let comparison;
  try {
    comparison = compareSerials(local.map((row) => row.serial), serials);
  } catch {
    throw new PkiError(502, "Invalid certificate serial list; comparison unavailable");
  }
  res.json({ sourceId: id, checkedAt: new Date().toISOString(), ...comparison });
}));
router.post(
  "/query",
  wrap((req, res, ctx) => {
    const query = validateQuery(req.body);
    query.sources = authorized(query.sources, ctx);
    res.json(store().query(query));
  }),
);
router.post("/selection", wrap((req, res, ctx) => {
  const query = validateQuery({ ...req.body, limit: 200, offset: undefined, cursor: undefined });
  query.sources = authorized(query.sources, ctx);
  const certificates: PkiBatchRef[] = [];
  const now = Date.now();
  store().transaction(() => {
    do {
      const page = store().query(query, false, now);
      certificates.push(...page.certificates.map(batchRef));
      if (certificates.length > pkiBatchLimit) throw new PkiError(400, "Select up to 10,000 certificates; narrow the search first");
      query.cursor = page.nextCursor ?? undefined;
    } while (query.cursor);
  });
  res.json({ certificates });
}));
router.post("/batch/preview", wrap(async (req, res, ctx) => {
  res.json({ items: await previewBatch(store(), ctx.adapter, ctx.sources, ctx.admin, batchAction(req.body?.action), batchRefs(req.body?.certificates)) });
}));
router.post("/batch/item", wrap(async (req, res, ctx) => {
  const action = batchAction(req.body?.action);
  if (action !== "export" && req.body?.confirm !== action) throw new PkiError(400, "Confirm the batch action");
  const [ref] = batchRefs([req.body?.certificate]);
  res.json(await executeBatchItem(store(), ctx.adapter, ctx.sources, ctx.admin, action, ref));
}));
router.get(
  "/certificates/:id",
  wrap(async (req, res, ctx) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id))
      throw new PkiError(400, "Invalid certificate ID");
    const c = store().certificate(
      id,
      ctx.sources.map((s) => s.id),
    );
    if (!c) throw new PkiError(404, "Certificate not found");
    const pem = store().pem(c.fingerprint);
    const conflicts = store().conflicts(c.sourceId, c.serial);
    const source = ctx.sources.find((s) => s.id === c.sourceId)!;
    const { issuer, issuerState, chain } = await findIssuer(pem!, source, ctx.adapter);
    let issuerCertificate = null;
    if (issuer) {
      const { der, ...parsed } = parseCertificate(issuer.pem);
      issuerCertificate = { ...parsed, root: chain?.certificates.some(item => item.root && item.pem.trim() === issuer.pem.trim()) ?? false };
    }
    res.json({ certificate: c, pem, issuer, issuerCertificate, issuerState, chain, conflicts });
  }),
);
router.route("/export").get(wrap(exportRecords)).post(wrap(exportRecords));
async function exportRecords(req: Request, res: Response, ctx: Context) {
  let raw = req.body;
  if (req.method === "GET") {
    try {
      raw = JSON.parse(String(req.query.filter));
    } catch {
      throw new PkiError(400, "Invalid export query");
    }
  }
  const query = validateQuery({ ...raw, limit: 200, cursor: undefined, offset: undefined });
  query.sources = authorized(query.sources, ctx);
  const format = String(req.query.format ?? "ndjson");
  if (!["csv", "json", "ndjson"].includes(format)) throw new PkiError(400, "Invalid export format");
  const fields = ["cn", "serial", "sourcePath", "type", "notBefore", "notAfter", "revoked", "fingerprint"] as const;
  const csv = (value: unknown) => {
    const text = String(value ?? "");
    return '"' + (/^[=+@\-\t\r\n]/.test(text) ? "'" : "") + text.replace(/"/g, '""') + '"';
  };
  res.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : format === "json" ? "application/json" : "application/x-ndjson");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="certificates.${format}"`,
  );
  const snapshot = new PkiStore(dbPath);
  const exportedAt = new Date().toISOString();
  let closed = false,
    count = 0;
  const release = () => {
    if (closed) return;
    closed = true;
    try {
      if (snapshot.db.isTransaction) snapshot.db.exec("ROLLBACK");
    } finally {
      snapshot.close();
    }
  };
  const timeout = setTimeout(() => res.destroy(), 120000);
  const onClose = () => {
    clearTimeout(timeout);
    release();
  };
  res.once("close", onClose);
  try {
    snapshot.db.exec("BEGIN");
    // Pin the snapshot before streaming; concurrent WAL writers can still commit.
    const coverage = snapshot.sources(query.sources);
    const metadata = { kind: "coverage", consistency: "snapshot", sources: coverage, exportedAt };
    res.write(format === "csv" ? "\uFEFF" + fields.map(csv).join(",") + "\r\n" : format === "json" ? JSON.stringify(metadata).slice(0, -1) + ',"certificates":[' : JSON.stringify(metadata) + "\n");
    while (!res.destroyed) {
      await ctx.adapter.verifyToken();
      const current = await ctx.adapter.allowed(await ctx.adapter.discover());
      if (
        !query.sources.every((id) => current.some((source) => source.id === id))
      )
        throw new PkiError(403, "Source access changed during export");
      if (res.destroyed) return;
      const page = snapshot.query(query, false, Date.parse(exportedAt));
      for (const certificate of page.certificates) {
        if (res.destroyed) return;
        const chunk = format === "csv"
          ? fields.map(field => csv(field === "notBefore" || field === "notAfter" ? new Date(certificate[field]).toISOString() : certificate[field])).join(",") + "\r\n"
          : format === "json" ? (count ? "," : "") + JSON.stringify(certificate) : JSON.stringify(certificate) + "\n";
        if (!res.write(chunk))
          await new Promise<void>((resolve) => {
            const done = () => {
              res.off("drain", done);
              res.off("close", done);
              resolve();
            };
            res.once("drain", done);
            res.once("close", done);
          });
        count++;
      }
      if (!page.nextCursor) break;
      query.cursor = page.nextCursor;
    }
    if (!res.destroyed)
      res.end(format === "csv" ? "" : format === "json" ? `],"complete":true,"count":${count}}` : JSON.stringify({ kind: "complete", count, exportedAt }) + "\n");
  } catch (error) {
    if (format !== "ndjson" && res.headersSent) res.destroy();
    else throw error;
  } finally {
    clearTimeout(timeout);
    res.off("close", onClose);
    release();
  }
}
router.get(
  "/jobs",
  wrap((_req, res, ctx) => {
    store().recover();
    res.json({ jobs: store().jobs(ctx.sources.map((s) => s.id)) });
  }),
);
router.get(
  "/jobs/:id",
  wrap((req, res, ctx) => {
    store().recover();
    const raw =
      req.query.errorLimit === undefined ? "20" : String(req.query.errorLimit);
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100)
      throw new PkiError(400, "errorLimit must be between 1 and 100");
    const details = store().jobDetails(
      String(req.params.id),
      ctx.sources.map((s) => s.id),
      Number(raw),
    );
    if (!details) throw new PkiError(404, "Job not found");
    res.json(details);
  }),
);
router.post(
  "/jobs",
  wrap((req, res, ctx) => {
    const ids = authorized(req.body.sources, ctx);
    if (!ids.length) throw new PkiError(400, "Select at least one source");
    const id = store().createJob(ids);
    launchCollection({
      id,
      dbPath,
      address: config.vaultAddr,
      token: ctx.token,
      namespace,
      skipTls: config.vaultSkipTlsVerify,
      ...limits,
    });
    res.status(202).json({ job: store().job(id) });
  }),
);
router.post(
  "/jobs/:id/:action",
  wrap((req, res, ctx) => {
    store().recover();
    const job = store().job(String(req.params.id));
    if (!job) throw new PkiError(404, "Job not found");
    authorized(job.sources, ctx);
    const action = req.params.action;
    if (action === "pause" && ["queued", "running"].includes(job.status)) {
      store().pause(job.id);
    } else if (
      action === "resume" &&
      ["paused", "partial", "interrupted"].includes(job.status)
    ) {
      store().resume(job.id);
      launchCollection({
        id: job.id,
        dbPath,
        address: config.vaultAddr,
        token: ctx.token,
        namespace,
        skipTls: config.vaultSkipTlsVerify,
        ...limits,
      });
    } else
      throw new PkiError(
        409,
        "Job cannot perform that action in its current state",
      );
    res.json({ job: store().job(job.id) });
  }),
);
router.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) {
    res.end(
      JSON.stringify({
        kind: "error",
        error: "Export interrupted; results are incomplete",
      }) + "\n",
    );
    return;
  }
  res.status(e instanceof PkiError ? e.status : 500).json({
    error: e instanceof PkiError ? e.message : "Certificate operation failed",
  });
});
export default router;
