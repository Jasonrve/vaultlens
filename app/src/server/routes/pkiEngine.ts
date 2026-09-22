import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { X509Certificate } from "node:crypto";
import { pkiOperations } from "../../shared/pkiOperations.js";
import { config } from "../config/index.js";
import { PkiAdapter, PkiError, scopePath } from "../pki/adapter.js";
import { normalizeSerial, parseCertificate } from "../pki/certificate.js";
import { findIssuer } from "../pki/issuer.js";
// Engine reads deliberately do not require certificate LIST access or a system token.
export const pkiEngineRouter = Router();
pkiEngineRouter
  .route("/")
  .all(async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!["GET", "POST"].includes(req.method))
        throw new PkiError(405, "Method not allowed");
      const input = req.method === "POST" ? req.body : req.query;
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new PkiError(400, "Invalid request body");
      const token = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : req.cookies?.vault_token;
      if (typeof token !== "string" || !token)
        throw new PkiError(401, "Authentication required");
      const adapter = new PkiAdapter(
        config.vaultAddr,
        token,
        process.env.VAULTLENS_PKI_NAMESPACE || "",
        config.vaultSkipTlsVerify,
      );
      await adapter.verifyToken();
      const mount = scopePath(String(input.mount || ""));
      const source = (await adapter.discover()).find((s) => s.path === mount);
      if (!source)
        throw new PkiError(
          404,
          "PKI mount not found or not visible to this session",
        );
      if (input.source && input.source !== source.id)
        throw new PkiError(
          409,
          "PKI mount identity changed; return to Secrets Engines",
        );
      const section = String(req.query.section || "overview"),
        ref = String(input.ref || "");
      if (
        ref &&
        (ref.length > 256 ||
          ref === "." ||
          ref === ".." ||
          /[\x00-\x1f\x7f/\\?#%]/.test(ref))
      )
        throw new PkiError(400, "Invalid PKI object reference");
      let result: unknown;
      if (req.method === "POST") {
        if (input.source !== source.id)
          throw new PkiError(409, "A current PKI mount identity is required");
        const operation = pkiOperations[String(input.action)];
        if (!operation || !Object.hasOwn(pkiOperations, String(input.action)))
          throw new PkiError(400, "Unsupported PKI operation");
        if (operation.reference && !ref)
          throw new PkiError(400, "Object reference is required");
        const mode = input.mode || "internal";
        if (
          !["internal", "exported", "existing"].includes(mode) ||
          (input.action === "key-generate" && mode === "existing")
        )
          throw new PkiError(400, "Invalid key generation mode");
        const fields = input.fields ?? {};
        if (!fields || typeof fields !== "object" || Array.isArray(fields))
          throw new PkiError(400, "Invalid operation fields");
        const body: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(fields)) {
          const field = operation.fields[key];
          if (!field || !Object.hasOwn(operation.fields, key))
            throw new PkiError(400, "Unsupported operation field: " + key);
          const valid =
            field.type === "array"
              ? Array.isArray(value) &&
                value.every((v) => typeof v === "string")
              : field.type === "integer"
                ? typeof value === "number" && Number.isSafeInteger(value)
                : typeof value === field.type ||
                  (field.format === "duration" &&
                    typeof value === "number" &&
                    Number.isFinite(value) &&
                    value >= 0);
          if (!valid || (field.enum && !field.enum.includes(String(value))))
            throw new PkiError(400, "Invalid value for " + key);
          body[key] = value;
        }
        if (
          operation.method === "DELETE" ||
          ["issuer-revoke", "certificate-revoke", "tidy-start"].includes(
            input.action,
          )
        ) {
          if (input.confirm !== source.path)
            throw new PkiError(
              400,
              "Confirm the mount name before this operation",
            );
        }
        const endpoint = operation.endpoint
          .replace("{ref}", encodeURIComponent(ref))
          .replace("{mode}", mode);
        const response = await adapter.request(
          `${source.path}/${endpoint}`,
          operation.method,
          body,
          4 * 1024 * 1024,
          true,
        );
        result = {
          source,
          data: response?.data ?? {},
          warnings: response?.warnings ?? [],
          action: input.action,
        };
      } else if (section === "overview") {
        const counts: Record<string, unknown> = {};
        for (const kind of ["roles", "issuers"]) {
          try {
            const data = (
              await adapter.request(`${source.path}/${kind}`, "LIST")
            ).data;
            counts[kind] = Array.isArray(data?.keys) ? data.keys.length : null;
            counts[kind + "Options"] = Array.isArray(data?.keys)
              ? data.keys.slice(0, 100)
              : [];
          } catch (e) {
            counts[kind] = e instanceof PkiError && e.status === 404 ? 0 : null;
          }
        }
        result = { source, data: counts };
      } else if (section === "configuration" || section === "tidy") {
        const paths =
          section === "tidy"
            ? ["tidy-status", "config/auto-tidy"]
            : [
                "config/cluster",
                "config/acme",
                "config/urls",
                "config/crl",
                "config/issuers",
                "mount",
              ];
        const data: Record<string, unknown> = {},
          errors: Record<string, string> = {};
        for (const path of paths) {
          try {
            data[path] =
              (
                await adapter.request(
                  path === "mount"
                    ? `sys/mounts/${source.path}/tune`
                    : `${source.path}/${path}`,
                  "GET",
                  undefined,
                  2 * 1024 * 1024,
                )
              ).data ?? {};
          } catch (e) {
            errors[path] = e instanceof PkiError ? e.message : "Read failed";
          }
        }
        result = { source, data, errors };
      } else if (
        section === "roles" ||
        section === "keys" ||
        section === "issuers" ||
        section === "certificates"
      ) {
        if (ref) {
          if (section === "certificates")
            throw new PkiError(400, "Use certificate lookup for a serial");
          const endpoint =
            section === "roles"
              ? "roles"
              : section === "keys"
                ? "key"
                : "issuer";
          result = {
            source,
            data: (
              await adapter.request(
                `${source.path}/${endpoint}/${encodeURIComponent(ref)}`,
                "GET",
                undefined,
                2 * 1024 * 1024,
              )
            ).data,
          };
        } else {
          const offset = Number(req.query.offset || 0);
          if (!Number.isSafeInteger(offset) || offset < 0)
            throw new PkiError(400, "Invalid offset");
          let data: { keys?: unknown; key_info?: Record<string, unknown> } = {};
          try {
            data = (
              await adapter.request(
                `${source.path}/${section === "certificates" ? "certs" : section}`,
                "LIST",
              )
            ).data;
          } catch (e) {
            if (!(e instanceof PkiError) || e.status !== 404) throw e;
            result = {
              source,
              items: [],
              total: 0,
              nextOffset: null,
              notice:
                "No entries returned; this endpoint may be unavailable on older mounts.",
            };
          }
          if (!result) {
            if (
              !Array.isArray(data?.keys) ||
              data.keys.some((k) => typeof k !== "string")
            )
              throw new PkiError(502, "Invalid PKI list response");
            const lookup = req.query.lookup === "true";
            const query = String(req.query.query || "")
              .trim()
              .toLowerCase();
            if (
              lookup &&
              (!["roles", "issuers"].includes(section) || query.length > 256)
            )
              throw new PkiError(400, "Invalid PKI lookup");
            const keys = (data.keys as string[]).filter((id) => {
              if (!lookup || !query) return true;
              const info = data.key_info?.[id];
              const name =
                info && typeof info === "object"
                  ? (info as Record<string, unknown>).issuer_name
                  : "";
              return (
                id.toLowerCase().includes(query) ||
                (typeof name === "string" && name.toLowerCase().includes(query))
              );
            });
            const items = keys
              .slice(offset, offset + 50)
              .map((id) => ({ id, info: data.key_info?.[id] ?? null }));
            if (section === "issuers" && !lookup) {
              for (let start = 0; start < items.length; start += 4) {
                await Promise.all(
                  items.slice(start, start + 4).map(async (item) => {
                    try {
                      const detail = (
                        await adapter.request(
                          `${source.path}/issuer/${encodeURIComponent(item.id)}`,
                          "GET",
                          undefined,
                          2 * 1024 * 1024,
                        )
                      ).data;
                      const certificate = new X509Certificate(
                        detail.certificate,
                      );
                      const parsed = parseCertificate(detail.certificate);
                      item.info = {
                        ...(item.info && typeof item.info === "object"
                          ? item.info
                          : {}),
                        issuer_name: detail.issuer_name,
                        common_name: parsed.cn,
                        serial_number: certificate.serialNumber
                          .match(/.{2}/g)
                          ?.join(":"),
                        ca_type:
                          certificate.checkIssued(certificate) &&
                          certificate.verify(certificate.publicKey)
                            ? "root"
                            : "intermediate",
                      };
                    } catch {
                      /* Keep authorized LIST metadata when individual reads are unavailable. */
                    }
                  }),
                );
              }
            }
            result = {
              source,
              items,
              total: keys.length,
              nextOffset: offset + 50 < keys.length ? offset + 50 : null,
            };
          }
        }
      } else if (section === "certificate") {
        let serial: string;
        try {
          serial = normalizeSerial(ref);
        } catch {
          throw new PkiError(400, "Invalid certificate serial");
        }
        // Vault expects byte pairs; catalog serials omit leading zeroes and separators.
        const vaultSerial = (serial.length % 2 ? "0" + serial : serial)
          .match(/.{2}/g)!
          .join("-");
        const observation = await adapter.certificate(source, vaultSerial);
        const { der, ...certificate } = parseCertificate(observation.pem);
        if (certificate.serial !== serial)
          throw new PkiError(
            502,
            "Vault returned a different certificate serial",
          );
        const issuer = await findIssuer(observation.pem, source, adapter);
        result = {
          source,
          certificate,
          pem: observation.pem,
          revocation: observation.revocation,
          observedAt: new Date().toISOString(),
          ...issuer,
        };
      } else throw new PkiError(400, "Unsupported PKI engine section");
      // Reject a remount/replacement while an object was being read.
      const current = (await adapter.discover()).find(
        (s) => s.id === source.id && s.path === source.path,
      );
      if (!current)
        throw new PkiError(
          409,
          req.method === "POST"
            ? "PKI mount identity changed; the operation may have completed. Refresh before retrying."
            : "PKI mount identity changed during the read",
        );
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
pkiEngineRouter.use(
  (e: unknown, _req: Request, res: Response, _next: NextFunction) =>
    res.status(e instanceof PkiError ? e.status : 500).json({
      error: e instanceof PkiError ? e.message : "PKI engine request failed",
    }),
);
export default pkiEngineRouter;
