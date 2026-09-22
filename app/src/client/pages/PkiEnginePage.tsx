import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { AxiosError } from "axios";
import * as api from "../lib/api";
import { pkiEngineUrl, type PkiEngineResult } from "../../shared/pkiEngine";
import type { PkiSource } from "../../shared/pki";
import { pkiOperations } from "../../shared/pkiOperations";
import ObjectPicker from "../components/pki-engine/ObjectPicker";
import OperationForm from "../components/pki-engine/OperationForm";
import DropdownChevron from "../components/common/DropdownChevron";
import {
  fieldLabel,
  fieldGroup,
  groupOrder,
  propertyValue,
  downloadText,
} from "../components/pki-engine/fields";
import "../components/pki-engine/pki-engine.css";
const configDescriptions: Record<string, string> = {
  "Cluster Config": "Paths used for cluster and certificate distribution.",
  "ACME Config": "Automated certificate enrollment.",
  "Global URLs": "Endpoints published in issued certificates.",
  "Certificate Revocation List (CRL)":
    "Revocation list generation and refresh.",
  "Online Certificate Status Protocol (OCSP)": "Certificate status responder.",
  "Default issuer": "Issuer used when a request does not specify one.",
};
const tabs = [
  "overview",
  "roles",
  "issuers",
  "keys",
  "certificates",
  "tidy",
  "configuration",
];
const errorText = (e: unknown) =>
  e instanceof AxiosError
    ? e.response?.data?.error || e.message
    : e instanceof Error
      ? e.message
      : "Request failed";
function Properties({
  data,
  grouped = false,
}: {
  data: Record<string, unknown>;
  grouped?: boolean;
}) {
  const entries = Object.entries(data).filter(
    ([key]) => !["certificate", "ca_chain"].includes(key),
  );
  return (
    <>
      {(grouped ? groupOrder : [""]).map((group) => {
        const rows = entries.filter(
          ([key]) => !grouped || fieldGroup(key) === group,
        );
        if (!rows.length) return null;
        return (
          <section className="engine-property-group" key={group}>
            {group && <h2>{group}</h2>}
            <dl className="engine-properties">
              {rows.map(([key, value]) => (
                <div key={key}>
                  <dt>{fieldLabel(key)}</dt>
                  <dd>{propertyValue(key, value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </>
  );
}
function Pem({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="engine-pem-panel">
      <h2>{title}</h2>
      <div className="engine-pem-actions">
        <button
          onClick={() =>
            downloadText(value, title.toLowerCase().replace(/ /g, "-") + ".pem")
          }
        >
          Download
        </button>
        <button
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => setCopied(true))
              .catch(() =>
                setError(
                  "Clipboard unavailable; select and copy the PEM below.",
                ),
              );
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <pre>{value}</pre>
    </section>
  );
}
export default function PkiEnginePage() {
  const navigate = useNavigate(),
    mount = useParams()["*"] || "",
    [params] = useSearchParams(),
    queryString = params.toString();
  const section = params.get("certificate")
    ? "certificate"
    : params.get("tab") || "overview";
  const ref =
    section === "certificate"
      ? params.get("certificate") || ""
      : params.get("ref") || "";
  const action = params.get("action") || "",
    expected = params.get("source") || undefined,
    offset = Number(params.get("offset") || 0);
  const [source, setSource] = useState<PkiSource | null>(null),
    [result, setResult] = useState<PkiEngineResult | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  const [serial, setSerial] = useState(""),
    [role, setRole] = useState(""),
    [issuer, setIssuer] = useState("");
  useEffect(() => {
    setRole("");
    setIssuer("");
  }, [mount, expected]);
  const [cached, setCached] = useState<Awaited<
    ReturnType<typeof api.pkiCertificate>
  > | null>(null);
  useEffect(() => {
    let active = true;
    setSource(null);
    setResult(null);
    setCached(null);
    setError("");
    setLoading(true);
    setSerial("");
    void (async () => {
      try {
        const overview = await api.pkiEngine(
          mount,
          "overview",
          undefined,
          expected,
        );
        if (!active) return;
        setSource(overview.source);
        if (section === "overview") {
          setResult(overview);
          return;
        }
        if (section === "certificate") {
          const record = params.get("record");
          const [live, snapshot] = await Promise.allSettled([
            api.pkiEngine(mount, section, ref, overview.source.id),
            record ? api.pkiCertificate(Number(record)) : Promise.resolve(null),
          ]);
          if (!active) return;
          if (live.status === "fulfilled") setResult(live.value);
          else setError(errorText(live.reason));
          if (snapshot.status === "fulfilled" && snapshot.value) {
            const c = snapshot.value.certificate;
            const normalized = ref
              .replace(/[:-]/g, "")
              .toLowerCase()
              .replace(/^0+(?=.)/, "");
            if (c.sourceId === overview.source.id && c.serial === normalized)
              setCached(snapshot.value);
          }
        } else {
          const r = await api.pkiEngine(
            mount,
            section,
            ref || undefined,
            overview.source.id,
            offset,
          );
          if (active) setResult(r);
        }
      } catch (e) {
        if (active) setError(errorText(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [mount, queryString, refresh]);
  const url = (values: Record<string, string | number | undefined> = {}) =>
    pkiEngineUrl(mount, { source: source?.id || expected, ...values });
  const act = (name: string, reference = ref) =>
    url({
      tab: pkiOperations[name].tab,
      ref: reference || undefined,
      action: name,
      ...(name === "certificate-revoke" ? { certificate: ref } : {}),
    });
  const cert = result?.certificate ?? cached?.certificate,
    pem = result?.pem ?? cached?.pem;
  const download = () => {
    if (pem) downloadText(pem, (cert?.serial || "certificate") + ".pem");
  };
  const returnUrl =
    section === "certificate"
      ? url({ certificate: ref })
      : url({
          tab: section,
          ...(ref && !action.endsWith("delete") ? { ref } : {}),
        });
  let initial: Record<string, unknown> | undefined;
  if (action.startsWith("config-"))
    initial = result?.data?.["config/" + action.slice(7)] as
      | Record<string, unknown>
      | undefined;
  else if (action === "certificate-revoke") initial = { serial_number: ref };
  else if (action.endsWith("-save")) initial = result?.data;
  const title =
    ref && !action
      ? section === "roles"
        ? "PKI Role " + ref
        : section === "issuers"
          ? "View Issuer Certificate"
          : section === "keys"
            ? "Key " + ref
            : section === "certificate"
              ? "Certificate"
              : mount
      : mount;
  return (
    <div className="engine-workspace">
      <p className="engine-breadcrumb">
        <Link to="/secrets">Secrets</Link> / <Link to={url()}>{mount}</Link>
        {ref && (
          <>
            {" "}
            /{" "}
            <Link
              to={url({
                tab: section === "certificate" ? "certificates" : section,
              })}
            >
              {fieldLabel(section === "certificate" ? "certificates" : section)}
            </Link>{" "}
            / {ref}
          </>
        )}
      </p>
      <h1>{title}</h1>
      <nav className="engine-tabs" aria-label="PKI engine sections">
        {tabs.map((tab) => (
          <Link
            key={tab}
            aria-current={
              (section === "certificate" ? "certificates" : section) === tab
                ? "page"
                : undefined
            }
            to={url({ tab })}
          >
            {fieldLabel(tab)}
          </Link>
        ))}
      </nav>
      {!action && (
        <div className="engine-toolbar">
          {section === "roles" &&
            (!ref ? (
              <Link className="engine-primary" to={act("role-save", "")}>Create role ＋</Link>
            ) : (
              <>
                <Link to={act("role-delete")}>Delete</Link>
                <Link to={act("issue")}>Generate Certificate</Link>
                <Link to={act("sign")}>Sign Certificate</Link>
                <Link to={act("role-save")}>Edit</Link>
              </>
            ))}
          {section === "issuers" &&
            (!ref ? (
              <>
                <Link to={act("issuer-import", "")}>Import ›</Link>
                <details className="engine-menu">
                  <summary className="ui-dropdown-control">Generate <DropdownChevron /></summary>
                  <div>
                    <Link to={act("root-generate", "")}>Root</Link>
                    <Link to={act("intermediate-generate", "")}>
                      Intermediate CSR
                    </Link>
                    <Link to={act("intermediate-set", "")}>
                      Import signed intermediate
                    </Link>
                  </div>
                </details>
              </>
            ) : (
              <>
                <Link to={act("intermediate-sign")}>Sign Intermediate</Link>
                <Link to={act("issuer-save")}>Configure</Link>
                <details className="engine-menu">
                  <summary className="ui-dropdown-control">More <DropdownChevron /></summary>
                  <div>
                    <Link to={act("issuer-revoke")}>Revoke</Link>
                    <Link to={act("issuer-delete")}>Delete</Link>
                  </div>
                </details>
              </>
            ))}
          {section === "keys" &&
            (!ref ? (
              <>
                <Link to={act("key-import", "")}>Import ⇧</Link>
                <Link className="engine-primary" to={act("key-generate", "")}>Generate ＋</Link>
              </>
            ) : (
              <>
                <Link to={act("key-save")}>Edit</Link>
                <Link to={act("key-delete")}>Delete</Link>
              </>
            ))}
          {section === "certificate" && (
            <>
              <button onClick={download} disabled={!pem}>
                Download
              </button>
              {result?.certificate && (
                <Link to={act("certificate-revoke")}>Revoke</Link>
              )}
            </>
          )}
          {section === "tidy" && (
            <>
              <Link to={act("config-auto-tidy", "")}>
                Configure automatic tidy
              </Link>
              <Link className="engine-primary" to={act("tidy-start", "")}>Tidy ›</Link>
              {(result?.data?.["tidy-status"] as Record<string, unknown>)
                ?.state === "Running" && (
                <Link to={act("tidy-cancel", "")}>Cancel tidy</Link>
              )}
            </>
          )}
          {section === "configuration" && (
            <>
              <Link className="engine-danger-link" to={act("root-delete", "")}>
                Delete all issuers
              </Link>
              <Link
                className="engine-primary"
                to={url({ tab: "configuration", action: "configuration-edit" })}
              >
                Edit configuration
              </Link>
            </>
          )}
        </div>
      )}
      {loading && <p role="status">Reading PKI engine…</p>}
      {error && (
        <div className="engine-error" role="alert">
          {error}
          {cached && (
            <p>
              The retained monitoring observation is shown below. The live Vault
              read failed.
            </p>
          )}
        </div>
      )}
      {action.startsWith("config-") &&
        result?.errors?.["config/" + action.slice(7)] && (
          <p className="engine-error" role="alert">
            {result.errors["config/" + action.slice(7)]}
          </p>
        )}
      {action &&
        action !== "configuration-edit" &&
        source &&
        !loading &&
        !(error && action.endsWith("-save") && ref) &&
        !result?.errors?.["config/" + action.slice(7)] && (
          <OperationForm
            key={mount + queryString}
            action={action}
            mount={mount}
            source={source.id}
            reference={ref}
            initial={initial}
            cancel={returnUrl}
            onSaved={() => {
              navigate(returnUrl);
              setRefresh((v) => v + 1);
            }}
          />
        )}
      {action === "configuration-edit" && source && result && !loading && (
        <section>
          <h2>Edit configuration</h2>
          <p>Save each configuration section separately.</p>
          {["cluster", "acme", "urls", "crl", "issuers"].map((key) => (
            <details
              className="engine-config-section"
              key={key}
              open={key === "cluster"}
            >
              <summary>
                {pkiOperations["config-" + key].title.replace(/^Save /, "")}
              </summary>
              {result.errors?.["config/" + key] ? (
                <p className="engine-error">{result.errors["config/" + key]}</p>
              ) : (
                <OperationForm
                  action={"config-" + key}
                  mount={mount}
                  source={source.id}
                  reference=""
                  initial={
                    result.data?.["config/" + key] as Record<string, unknown>
                  }
                  cancel={url({ tab: "configuration" })}
                  onSaved={() => navigate(url({ tab: "configuration" }))}
                />
              )}
            </details>
          ))}
        </section>
      )}
      {!action && section === "overview" && source && (
        <div className="engine-overview">
          <section className="engine-resource-summary" aria-label="Mount resources">
            <h2>Mount resources</h2>
            {["issuers", "roles"].map((kind) => (
              <Link className="engine-resource-stat" key={kind} to={url({ tab: kind })}>
                <strong className="engine-count">
                  {result?.data?.[kind] === null ? "Unavailable" : String(result?.data?.[kind] ?? "…")}
                </strong>
                <span><span className="engine-resource-name">{fieldLabel(kind)} ›</span>
                  <small>{kind === "issuers" ? "Root & intermediate CAs" : "Issuance policies"}</small>
                </span>
              </Link>
            ))}
          </section>
          <section className="engine-operations" aria-label="Certificate operations">
            <header><h2>Certificate operations</h2></header>
          <section className="engine-operation-row">
            <div className="engine-operation-description">
            <h2>Issue certificate</h2>
            <p>Choose a role to generate a certificate.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (role.trim()) navigate(act("issue", role.trim()));
              }}
            >
              <ObjectPicker
                key={mount + source.id + "roles"}
                mount={mount}
                source={source.id}
                kind="roles"
                label="Role"
                placeholder="Type to find a role…"
                value={role}
                onChange={setRole}
              />
              <button className="engine-primary" disabled={!role.trim()}>Issue</button>
            </form>
          </section>
          <section className="engine-operation-row">
            <div className="engine-operation-description">
            <h2>View certificate</h2>
            <p>Enter a serial number to view its certificate.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                navigate(url({ certificate: serial.trim() }));
              }}
            >
              <input
                aria-label="Certificate serial number"
                placeholder="33:a3:…"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
              />
              <button disabled={!serial.trim()}>View</button>
            </form>
          </section>
          <section className="engine-operation-row">
            <div className="engine-operation-description">
            <h2>View issuer</h2>
            <p>Enter an issuer name or ID to view its details.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                navigate(url({ tab: "issuers", ref: issuer.trim() }));
              }}
            >
              <ObjectPicker
                key={mount + source.id + "issuers"}
                mount={mount}
                source={source.id}
                kind="issuers"
                label="Issuer name or ID"
                placeholder="Type to find an issuer…"
                value={issuer}
                onChange={setIssuer}
              />
              <button disabled={!issuer.trim()}>View</button>
            </form>
          </section>
          </section>
        </div>
      )}
      {!action && result?.items && (
        <section className="engine-object-list">
          <header className="engine-section-header">
            <div>
              <h2>{fieldLabel(section)}</h2>
              <p>{section === "roles" ? "Roles configured to issue certificates in this mount."
                : section === "issuers" ? "Root and intermediate certificate authorities."
                : section === "keys" ? "Signing key metadata for this mount."
                : "Certificates stored in this PKI mount."}</p>
            </div>
          </header>
          {section === "keys" && (
            <p className="engine-list-description">
              Keys are used by issuers to sign certificates. This list shows key
              metadata; private key material remains in Vault.
            </p>
          )}
          {result.notice && <p className="engine-empty">{result.notice}</p>}
          {result.items.map((item) => {
            const info =
              item.info && typeof item.info === "object"
                ? (item.info as Record<string, unknown>)
                : {};
            const target =
              section === "certificates"
                ? url({ certificate: item.id })
                : url({ tab: section, ref: item.id });
            return (
              <div className="engine-list-row" key={item.id}>
                <div>
                  <Link to={target}>
                    {String(info.issuer_name || info.key_name || item.id)}
                  </Link>
                  {section === "issuers" && (
                    <p className="engine-list-meta">
                      {info.is_default === true && (
                        <span className="engine-badge">default issuer</span>
                      )}
                      {!!info.ca_type && (
                        <span className="engine-badge">
                          {String(info.ca_type)}
                        </span>
                      )}
                      {String(info.serial_number || "")}{" "}
                      {String(info.common_name || "")}
                    </p>
                  )}
                </div>
                <details className="engine-menu">
                  <summary aria-label={"Manage " + item.id}>···</summary>
                  <div>
                    <Link to={target}>
                      View{" "}
                      {section === "certificates"
                        ? "certificate"
                        : section.slice(0, -1)}
                    </Link>
                    {section === "roles" && (
                      <>
                        <Link to={act("issue", item.id)}>
                          Generate Certificate
                        </Link>
                        <Link to={act("role-save", item.id)}>Edit</Link>
                      </>
                    )}
                  </div>
                </details>
              </div>
            );
          })}
          <div className="engine-pagination">
            <span>
              {result.total ? offset + 1 : 0}–
              {Math.min(offset + 50, result.total || 0)} of {result.total || 0}
            </span>
            <button
              disabled={!offset}
              onClick={() =>
                navigate(
                  url({ tab: section, offset: Math.max(0, offset - 50) }),
                )
              }
            >
              ‹
            </button>
            <span aria-current="page">{Math.floor(offset / 50) + 1}</span>
            <button
              disabled={result.nextOffset == null}
              onClick={() =>
                navigate(url({ tab: section, offset: result.nextOffset! }))
              }
            >
              ›
            </button>
          </div>
        </section>
      )}
      {!action &&
        ref &&
        result?.data &&
        ["roles", "issuers", "keys"].includes(section) && (
          <section>
            {section === "roles" && (
              <p className="engine-notice">
                Issuer:{" "}
                <Link
                  to={url({
                    tab: "issuers",
                    ref: String(result.data.issuer_ref || "default"),
                  })}
                >
                  {String(result.data.issuer_ref || "default")}
                </Link>
                . This is the current role configuration; it does not establish
                the role used for previously issued certificates.
              </p>
            )}
            {typeof result.data.certificate === "string" && (
              <Pem title="Certificate" value={result.data.certificate} />
            )}
            {Array.isArray(result.data.ca_chain) && (
              <Pem title="CA chain" value={result.data.ca_chain.join("\n")} />
            )}
            <Properties data={result.data} grouped={section === "roles"} />
            {section === "issuers" &&
              typeof result.data.key_id === "string" && (
                <Link to={url({ tab: "keys", ref: result.data.key_id })}>
                  View signing key
                </Link>
              )}
          </section>
        )}
      {!action && section === "configuration" && result && (
        <div id="engine-config-edit">
          {(
            [
              ["cluster", "Cluster Config", ["path", "aia_path"]],
              [
                "acme",
                "ACME Config",
                [
                  "enabled",
                  "default_directory_policy",
                  "allowed_roles",
                  "allow_role_ext_key_usage",
                  "allowed_issuers",
                  "eab_policy",
                  "dns_resolver",
                  "max_ttl",
                ],
              ],
              [
                "urls",
                "Global URLs",
                [
                  "issuing_certificates",
                  "crl_distribution_points",
                  "ocsp_servers",
                ],
              ],
              [
                "crl",
                "Certificate Revocation List (CRL)",
                ["disable", "expiry", "auto_rebuild", "enable_delta"],
              ],
              [
                "crl",
                "Online Certificate Status Protocol (OCSP)",
                ["ocsp_disable", "ocsp_expiry"],
              ],
              [
                "issuers",
                "Default issuer",
                ["default", "default_follows_latest_issuer"],
              ],
            ] as [string, string, string[]][]
          ).map(([key, title, fields]) => {
            const data =
              (result.data?.["config/" + key] as Record<string, unknown>) || {};
            const shown = Object.fromEntries(
              fields.map((field) => [
                field === "disable"
                  ? "CRL building"
                  : field === "ocsp_disable"
                    ? "Responder APIs"
                    : field === "enabled" && key === "acme"
                      ? "ACME enabled"
                      : field,
                field === "disable" || field === "ocsp_disable"
                  ? data[field] === undefined
                    ? "Unavailable"
                    : data[field]
                      ? "Disabled"
                      : "Enabled"
                  : data[field],
              ]),
            );
            const extra = Object.fromEntries(
              Object.entries(data).filter(
                ([field]) =>
                  !fields.includes(field) &&
                  !(
                    key === "crl" &&
                    [
                      "ocsp_disable",
                      "ocsp_expiry",
                      "disable",
                      "expiry",
                      "auto_rebuild",
                      "enable_delta",
                    ].includes(field)
                  ),
              ),
            );
            return (
              <section className="engine-config-section" key={title}>
                <header className="engine-section-header">
                  <div>
                    <h2>{title}</h2>
                    <p>{configDescriptions[title]}</p>
                  </div>
                  <Link
                    className="engine-section-edit"
                    to={act("config-" + key, "")}
                    aria-label={"Edit " + title}
                  >
                    Edit
                  </Link>
                </header>
                {result.errors?.["config/" + key] ? (
                  <p className="engine-notice">
                    {result.errors["config/" + key]}
                  </p>
                ) : (
                  <>
                    <Properties data={shown} />
                    {Object.keys(extra).length > 0 &&
                      !title.includes("OCSP") && (
                        <details>
                          <summary>Additional settings</summary>
                          <Properties data={extra} />
                        </details>
                      )}
                  </>
                )}
              </section>
            );
          })}
          <details className="engine-config-section">
            <summary>Show mount configuration</summary>
            {result.errors?.mount ? (
              <p>{result.errors.mount}</p>
            ) : (
              <Properties
                data={(result.data?.mount as Record<string, unknown>) || {}}
              />
            )}
          </details>
        </div>
      )}
      {!action && section === "tidy" && result && (
        <section>
          {result.errors?.["tidy-status"] ? (
            <p className="engine-notice">{result.errors["tidy-status"]}</p>
          ) : !(result.data?.["tidy-status"] as Record<string, unknown>)
              ?.time_started ? (
            <div className="engine-empty">
              <h2>Tidy status unavailable</h2>
              <p>
                The next tidy operation will provide status information here.
              </p>
              <Link className="engine-primary" to={act("tidy-start", "")}>Tidy ›</Link>
            </div>
          ) : (
            <>
              <div className="engine-section-header engine-status-header"><h2>Tidy status</h2></div>
              <Properties
                data={result.data?.["tidy-status"] as Record<string, unknown>}
              />
              <button onClick={() => setRefresh((v) => v + 1)}>
                Refresh status
              </button>
            </>
          )}
          <details className="engine-config-section">
            <summary>Automatic tidy configuration</summary>
            {result.errors?.["config/auto-tidy"] ? (
              <p>{result.errors["config/auto-tidy"]}</p>
            ) : (
              <Properties
                data={
                  (result.data?.["config/auto-tidy"] as Record<
                    string,
                    unknown
                  >) || {}
                }
              />
            )}
          </details>
        </section>
      )}
      {!action && section === "certificate" && cert && (
        <section className="engine-section engine-detail engine-detail-panel">
          <h2>{cert.cn || cert.serial}</h2>
          <p>
            <strong>
              {cert.notAfter <= Date.now()
                ? "Expired"
                : cert.notBefore > Date.now()
                  ? "Not yet valid"
                  : "Valid"}
            </strong>{" "}
            · {result?.certificate ? "Live Vault read" : "Monitoring snapshot"}
          </p>
          {result?.certificate &&
            cached &&
            result.certificate.fingerprint !==
              cached.certificate.fingerprint && (
              <p className="engine-error">
                Identity conflict: the live certificate differs from the
                retained monitoring observation. The original observation has
                not been replaced.
              </p>
            )}
          <Properties
            data={{
              serial: cert.serial,
              fingerprint: cert.fingerprint,
              subject: cert.subject,
              issuer: cert.issuer,
              valid_from: new Date(cert.notBefore).toISOString(),
              expires_at: new Date(cert.notAfter).toISOString(),
              usage: cert.type,
              revocation: result?.revocation ?? cached?.certificate.revoked,
              observed_at: result?.observedAt ?? cached?.certificate.lastSeen,
              sans: cert.sans,
              role: "Unknown: no issuance evidence",
            }}
          />
          {result?.issuer?.ref && (
            <p>
              <Link to={url({ tab: "issuers", ref: result.issuer.ref })}>
                View verified signing issuer
              </Link>
            </p>
          )}
          <p className="engine-muted">
            Issuer evidence: {result?.issuerState ?? cached?.issuerState}.
            Signature verification is not a complete trust-chain verdict.
          </p>
          <div className="engine-inline">
            <button onClick={download}>Download PEM</button>
            <Link
              to={
                "/certificates?filter=" +
                encodeURIComponent(
                  JSON.stringify({
                    sources: [source!.id],
                    conditions: [
                      {
                        field: "serial",
                        operator: "equals",
                        value: cert.serial,
                      },
                    ],
                    match: "all",
                    sort: "notAfter",
                    direction: "asc",
                    limit: 50,
                  }),
                )
              }
            >
              Find in Certificates monitoring
            </Link>
          </div>
          <details>
            <summary>Certificate PEM</summary>
            <pre>{pem}</pre>
          </details>
          {cached && (
            <details>
              <summary>Retained monitoring observation</summary>
              <Properties
                data={{
                  fingerprint: cached.certificate.fingerprint,
                  last_observed: cached.certificate.lastSeen,
                  revocation: cached.certificate.revoked,
                  presence: cached.certificate.presence,
                }}
              />
              <pre>{cached.pem}</pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
