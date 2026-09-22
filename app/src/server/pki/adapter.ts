import axios from "axios";
import https from "node:https";
import { createHash } from "node:crypto";
import type { PkiSource } from "../../shared/pki.js";
export class PkiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class SourceChanged extends PkiError {
  constructor() {
    super(
      403,
      "Vault source identity, path or access changed; resume after reviewing sources",
    );
  }
}
export function scopePath(value: string): string {
  const clean = value.replace(/^\/+|\/+$/g, "");
  if (
    clean.length > 1024 ||
    clean.split("/").some((p) => !p || p === "." || p === "..") ||
    /[\0?#\\]/.test(clean)
  )
    throw new PkiError(400, "Invalid scope path");
  return clean;
}
export class PkiAdapter {
  private http;
  constructor(
    address: string,
    private token: string,
    public namespace = "",
    skipTls = false,
    private beforeRequest?: () => Promise<void>,
  ) {
    if (namespace) this.namespace = scopePath(namespace);
    this.http = axios.create({
      baseURL: address.replace(/\/$/, "") + "/v1/",
      timeout: 30000,
      maxRedirects: 0,
      maxContentLength: 128 * 1024 * 1024,
      headers: {
        "X-Vault-Token": token,
        ...(namespace ? { "X-Vault-Namespace": this.namespace } : {}),
      },
      ...(skipTls
        ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
        : {}),
    });
  }
  async request(
    path: string,
    method = "GET",
    data?: unknown,
    maxContentLength?: number,
    validationDetails = false,
  ): Promise<any> {
    await this.beforeRequest?.();
    try {
      return (
        await this.http.request({
          url: path,
          method: method === "LIST" ? "GET" : method,
          ...(method === "LIST" ? { params: { list: true } } : {}),
          data,
          ...(maxContentLength ? { maxContentLength } : {}),
        })
      ).data;
    } catch (e) {
      const status = axios.isAxiosError(e) ? (e.response?.status ?? 503) : 503;
      if (validationDetails && status === 400 && axios.isAxiosError(e)) {
        const errors = e.response?.data?.errors;
        if (
          Array.isArray(errors) &&
          errors.every((item) => typeof item === "string")
        ) {
          const message = errors.join("; ").slice(0, 1500);
          if (!/-----BEGIN|PRIVATE KEY/.test(message))
            throw new PkiError(400, message);
        }
      }
      throw new PkiError(
        status,
        status === 403 || status === 401
          ? "Vault permission denied or token expired"
          : status === 404
            ? "Vault resource not found or endpoint unsupported"
            : status === 429
              ? "Vault rate limit exceeded"
              : "Vault request failed",
      );
    }
  }
  async verifyToken() {
    return (await this.request("auth/token/lookup-self")).data;
  }
  async discover(): Promise<PkiSource[]> {
    const health = await this.request(
      "sys/health?standbyok=true&perfstandbyok=true",
    );
    if (!health.cluster_id)
      throw new PkiError(503, "Vault cluster identity unavailable");
    let mounts: Record<string, any>;
    try {
      mounts = (await this.request("sys/mounts")).data;
    } catch (e) {
      if (!(e instanceof PkiError) || e.status !== 403) throw e;
      mounts = (await this.request("sys/internal/ui/mounts")).data?.secret;
    }
    if (!mounts || typeof mounts !== "object")
      throw new PkiError(503, "Vault mount discovery unavailable");
    return Object.entries(mounts)
      .filter(([, m]) => m.type === "pki" && m.accessor)
      .map(([path, m]) => ({
        id: createHash("sha256")
          .update(
            JSON.stringify([health.cluster_id, this.namespace, m.accessor]),
          )
          .digest("hex"),
        cluster: health.cluster_id,
        namespace: this.namespace,
        accessor: m.accessor,
        path: scopePath(path),
        description: m.description ?? "",
        lastCollected: null,
        coverage: "not_collected",
      }));
  }
  async allowed(sources: PkiSource[]): Promise<PkiSource[]> {
    const paths = sources.map((s) => s.path + "/certs");
    if (!paths.length) return [];
    const result = await this.request("sys/capabilities-self", "POST", {
      paths,
    });
    return sources.filter((s, i) => {
      const caps =
        result[paths[i]] ??
        result.data?.[paths[i]] ??
        (paths.length === 1
          ? (result.capabilities ?? result.data?.capabilities)
          : []);
      return (
        Array.isArray(caps) &&
        (caps.includes("root") || caps.includes("list")) &&
        !caps.includes("deny")
      );
    });
  }
  async assertSource(source: PkiSource) {
    const current = (await this.discover()).find(
      (s) =>
        s.id === source.id &&
        s.path === source.path &&
        s.cluster === source.cluster &&
        s.namespace === source.namespace &&
        s.accessor === source.accessor,
    );
    if (!current || !(await this.allowed([current])).length)
      throw new SourceChanged();
  }
  async serials(source: PkiSource, revoked = false): Promise<string[]> {
    try {
      const response = await this.request(
        source.path + (revoked ? "/certs/revoked" : "/certs"),
        "LIST",
      );
      if (
        !Array.isArray(response.data?.keys) ||
        response.data.keys.some((x: unknown) => typeof x !== "string")
      )
        throw new PkiError(502, "Invalid certificate list response");
      return response.data.keys;
    } catch (e) {
      if (e instanceof PkiError && e.status === 404 && !revoked) return [];
      throw e;
    }
  }
  async certificate(source: PkiSource, serial: string) {
    if (!/^[a-fA-F0-9:-]+$/.test(serial) && serial !== "ca")
      throw new PkiError(400, "Invalid certificate serial");
    const result = await this.request(
      source.path + "/cert/" + serial,
      "GET",
      undefined,
      1024 * 1024,
    );
    if (typeof result.data?.certificate !== "string")
      throw new PkiError(502, "Certificate body unavailable");
    return {
      pem: result.data.certificate as string,
      revocation:
        typeof result.data.revocation_time === "number"
          ? ((result.data.revocation_time > 0 ? "revoked" : "not_revoked") as
              | "revoked"
              | "not_revoked")
          : ("unknown" as const),
    };
  }
  async pem(source: PkiSource, serial: string) {
    return (await this.certificate(source, serial)).pem;
  }
}
