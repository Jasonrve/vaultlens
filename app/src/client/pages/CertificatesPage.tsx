import IssuerCertificateView from "../components/pki/IssuerCertificateView";
import CertificatePemActions from "../components/pki/CertificatePemActions";
import { pkiEngineUrl } from "../../shared/pkiEngine";
import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AxiosError } from "axios";
import * as api from "../lib/api";
import type {
  CertificateRecord,
  PkiCondition,
  PkiJob,
  PkiQuery,
  PkiSource,
  PkiSourceCheck,
  PkiSummary,
} from "../../shared/pki";
import { restorePkiQuery, pkiSelectionKey } from "../../shared/pkiSelection";
import CertificateOverview from "../components/pki/CertificateOverview";
import CollectionProgress from "../components/pki/CollectionProgress";
import CertificateSearch from "../components/pki/CertificateSearch";
import CertificateDialog from "../components/pki/CertificateDialog";
import CertificatePagination from "../components/pki/CertificatePagination";
import CertificateBatchControls from "../components/pki/CertificateBatchControls";
import { pkiBatchLimit, type PkiBatchRef } from "../../shared/pkiBatch";
import DropdownChevron from "../components/common/DropdownChevron";
import "../components/pki/pki.css";
const coverageText: Record<string, string> = {
  complete: "All listed certificates read; revocation evidence available.",
  partial:
    "Some listing or certificate reads failed. The catalog is incomplete.",
  revocation_unknown:
    "Listed certificates read; some revocation evidence is unavailable.",
  not_collected: "No completed observation yet.",
};
const emptyCondition: PkiCondition = {
  field: "cn",
  operator: "contains",
  value: "",
};
const labelType: Record<string, string> = {
  server: "Server",
  client: "Client",
  both: "Server + client",
  ca: "CA",
  unknown: "Other / unknown",
};
const labelRevocation: Record<string, string> = {
  revoked: "Revoked",
  not_revoked: "Not revoked",
  unknown: "Unknown",
};
const labelUsage: Record<string, string> = {
  "1.3.6.1.5.5.7.3.1": "Server authentication",
  "1.3.6.1.5.5.7.3.2": "Client authentication",
  "1.3.6.1.5.5.7.3.3": "Code signing",
  "1.3.6.1.5.5.7.3.4": "Email protection",
};
const message = (e: unknown) =>
  e instanceof AxiosError
    ? e.response?.data?.error || e.message
    : e instanceof Error
      ? e.message
      : "Request failed";
const date = (n: number) => new Date(n).toISOString().slice(0, 10);
function certificateExpiry(c: CertificateRecord) {
  const now = Date.now();
  const remaining = c.notAfter - now;
  if (remaining <= 0) return { label: "Expired", tone: "expired", days: `${Math.floor(-remaining / 86400000)}d` };
  if (c.notBefore > now) return { label: "Not yet valid", tone: "pending", days: `in ${Math.ceil((c.notBefore - now) / 86400000)}d` };
  return { label: remaining <= 30 * 86400000 ? "Expiring" : "Valid", tone: remaining <= 30 * 86400000 ? "warning" : "valid", days: `in ${Math.ceil(remaining / 86400000)}d` };
}
export default function CertificatesPage() {
  const [pemFeedback, setPemFeedback] = useState("");
  const [showSigningCa, setShowSigningCa] = useState(false);
  const [sanDetail, setSanDetail] = useState<CertificateRecord | null>(null);
  const [clusterInfo, setClusterInfo] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    let active = true;
    void api.getVaultHealth().then(health => {
      if (active && typeof health.cluster_id === "string" && typeof health.cluster_name === "string")
        setClusterInfo({ id: health.cluster_id, name: health.cluster_name });
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState("inventory"),
    [sources, setSources] = useState<PkiSource[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [sourceChecks, setSourceChecks] = useState<Record<string, { result?: PkiSourceCheck; error?: string; checking?: boolean; lastCollected?: string | null }>>({});
  const [checkingSources, setCheckingSources] = useState(false);
  const checkingSourcesRef = useRef(false);
  const checkGeneration = useRef(0);
  useEffect(() => () => { checkGeneration.current++; }, []);
  async function checkSources() {
    if (checkingSourcesRef.current) return;
    checkingSourcesRef.current = true;
    setCheckingSources(true);
    const gen = ++checkGeneration.current;
    try {
      const scope = await api.pkiSources();
      if (gen !== checkGeneration.current) return;
      acceptSources(scope.sources);
      const pending = scope.sources.filter((source) => {
        const check = sourceChecks[source.id];
        return !check?.result || check.lastCollected !== source.lastCollected
          || check.result.localCount !== source.certificateCount
          || Date.now() - Date.parse(check.result.checkedAt) >= 120000;
      });
      await Promise.all([0, 1].map(async () => {
        while (pending.length && gen === checkGeneration.current) {
          const source = pending.shift()!;
          setSourceChecks((checks) => ({ ...checks, [source.id]: { checking: true } }));
          try {
            const result = await api.pkiCheckSource(source.id);
            if (gen === checkGeneration.current) setSourceChecks((checks) => ({ ...checks, [source.id]: { result, lastCollected: source.lastCollected } }));
          } catch (e) {
            if (gen === checkGeneration.current) setSourceChecks((checks) => ({ ...checks, [source.id]: { error: message(e) } }));
          }
        }
      }));
    } catch (e) {
      if (gen === checkGeneration.current) {
        setSourceChecks({});
        setError(message(e));
      }
    } finally {
      checkingSourcesRef.current = false;
      setCheckingSources(false);
    }
  }
  const [advancedSearch, setAdvancedSearch] = useState(false);
  const [quickSearch, setQuickSearch] = useState("");
  const searchModeInitialized = useRef(false);
  const [conditions, setConditions] = useState<PkiCondition[]>([
      { ...emptyCondition },
    ]),
    [match, setMatch] = useState<"all" | "any">("all");
  const [type, setType] = useState(""),
    [valid, setValid] = useState(""),
    [revoked, setRevoked] = useState(""),
    [sort, setSort] = useState<PkiQuery["sort"]>("notAfter");
  const [direction, setDirection] = useState<PkiQuery["direction"]>("asc");
  const [exportOpen, setExportOpen] = useState(false);
  const exportControl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!exportControl.current?.contains(event.target as Node)) setExportOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [exportOpen]);
  const [summary, setSummary] = useState<PkiSummary | null>(null);
  const [rows, setRows] = useState<CertificateRecord[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(50);
  const [query, setQuery] = useState<PkiQuery | null>(null),
    [jobs, setJobs] = useState<PkiJob[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof api.pkiCertificate>
  > | null>(null);
  const generation = useRef(0),
    detailGeneration = useRef(0);
  const [expandedJob, setExpandedJob] = useState<string | null>(null),
    [actionBusy, setActionBusy] = useState(false);
  const [checkedCertificates, setCheckedCertificates] = useState<Map<number, PkiBatchRef>>(new Map());
  const selectionScope = query ? JSON.stringify({ sources: query.sources, conditions: query.conditions, match: query.match, type: query.type, validity: query.validity, revocation: query.revocation }) : "";
  useEffect(() => { setCheckedCertificates(new Map()); }, [selectionScope]);
  function selectCertificates(certificates: CertificateRecord[], checked: boolean) {
    const next = new Map(checkedCertificates);
    for (const c of certificates) {
      if (checked) next.set(c.id, { id: c.id, sourceId: c.sourceId, fingerprint: c.fingerprint, serial: c.serial, cn: c.cn, sourcePath: c.sourcePath });
      else next.delete(c.id);
    }
    if (next.size > pkiBatchLimit) { setError("Select up to 10,000 certificates; narrow the search first"); return; }
    setCheckedCertificates(next);
  }
  const checkedOnPage = rows.filter(c => checkedCertificates.has(c.id)).length;
  const filterParams = params.toString();
  const canSaveSelection = useRef(false);
  const sourcePicker = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismissSourcePicker(event: PointerEvent | FocusEvent) {
      const picker = sourcePicker.current;
      if (picker?.open && event.target instanceof Node && !picker.contains(event.target)) {
        picker.open = false;
      }
    }
    document.addEventListener("pointerdown", dismissSourcePicker, true);
    document.addEventListener("focusin", dismissSourcePicker);
    return () => {
      document.removeEventListener("pointerdown", dismissSourcePicker, true);
      document.removeEventListener("focusin", dismissSourcePicker);
    };
  }, []);
  async function run(q: PkiQuery) {
    const gen = ++generation.current;
    setBusy(true);
    setSummary(null);
    setError("");
    setDetail(null);
    detailGeneration.current++;
    try {
      const [r, scope] = await Promise.all([api.pkiQuery(q), api.pkiSources()]);
      if (gen !== generation.current) return;
      setSources(scope.sources);
      setSelected((ids) =>
        ids.filter((id) => scope.sources.some((s) => s.id === id)),
      );
      if (q.sources.some((id) => !scope.sources.some((s) => s.id === id)))
        throw new Error("Source access changed. Apply the current selection.");
      if ((q.offset ?? 0) > 0 && (q.offset ?? 0) >= r.total) {
        void run({ ...q, offset: Math.max(0, Math.ceil(r.total / q.limit) - 1) * q.limit });
        return;
      }
      setSummary(r.summary);
      setRows(r.certificates);
      setTotal(r.total);
      setPage(Math.floor((q.offset ?? 0) / q.limit) + 1);
      setPageSize(q.limit);
      setQuery(q);
    } catch (e) {
      if (gen === generation.current) {
        setError(message(e));
        setQuery(null);
        setSummary(null);
      setRows([]);
        setTotal(0);

      }
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    canSaveSelection.current = false;
    setPage(1);
    setReady(false);
    setRows([]);
    setQuery(null);
    setDetail(null);

    setTotal(0);
    void api
      .pkiSources()
      .then((r) => {
        if (cancelled) return;
        setSources(r.sources);
        let saved: unknown;
        try {
          saved = JSON.parse(sessionStorage.getItem(pkiSelectionKey) || "null");
        } catch {
          /* Browser storage may be unavailable. */
        }
        const q = restorePkiQuery(
          new URLSearchParams(filterParams),
          r.sources,
          saved,
        );
        canSaveSelection.current = true;
        setSelected(q.sources);
        setReady(true);
        const quick = q.conditions.length === 1 && q.conditions[0].field === "text";
        if (quick) setQuickSearch(q.conditions[0].value);
        else if (q.conditions.length) { setConditions(q.conditions); setMatch(q.match); }
        if (!searchModeInitialized.current) {
          setAdvancedSearch(q.conditions.length > 0 && !quick);
          searchModeInitialized.current = true;
        }
        setType(q.type ?? "");
        setValid(q.validity ?? "");
        setRevoked(q.revocation ?? "");
        setSort(q.sort);
        setDirection(q.direction);
        void run(q);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(message(e));
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
      generation.current++;
      detailGeneration.current++;
    };
  }, [filterParams]);
  useEffect(() => {
    if (ready && canSaveSelection.current) {
      try {
        sessionStorage.setItem(pkiSelectionKey, JSON.stringify(selected));
      } catch {
        /* Selection still works without storage. */
      }
    }
  }, [selected, ready]);
  function acceptSources(nextSources: PkiSource[]) {
    setSources(nextSources);
    setSourceChecks((checks) => Object.fromEntries(Object.entries(checks).filter(([id, check]) => {
      const source = nextSources.find((item) => item.id === id);
      return source && (!check.result || (check.lastCollected === source.lastCollected && check.result.localCount === source.certificateCount));
    })));
    setSelected((ids) =>
      ids.filter((id) => nextSources.some((s) => s.id === id)),
    );
    if (query?.sources.some((id) => !nextSources.some((s) => s.id === id))) {
      generation.current++;
      detailGeneration.current++;
      setSummary(null);
      setRows([]);
      setQuery(null);
      setDetail(null);

      setTotal(0);
      setBusy(false);
      setError(
        "Source access changed. Apply the current authorized selection.",
      );
    }
  }
  useEffect(() => {
    if (tab !== "jobs") return;
    let active = true,
      loading = false;
    const load = () => {
      if (document.visibilityState === "hidden" || loading) return;
      loading = true;
      void api
        .pkiJobs()
        .then((r) => {
          if (active) {
            setJobs(r.jobs);
            void api
              .pkiSources()
              .then((s) => {
                if (active) acceptSources(s.sources);
              })
              .catch(() => {});
          }
        })
        .catch((e) => {
          if (active) {
            setError(message(e));
            setJobs([]);
            setExpandedJob(null);
          }
        })
        .finally(() => {
          loading = false;
        });
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [tab]);
  function search() {
    const q: PkiQuery = {
      sources: selected,
      conditions: advancedSearch ? conditions.filter((c) => c.value.trim()) : quickSearch.trim() ? [{ field: "text", operator: "contains", value: quickSearch.trim() }] : [],
      match: advancedSearch ? match : "all",
      type,
      validity: valid,
      revocation: revoked,
      sort,
      direction,
      limit: pageSize,
    };
    setPage(1);
    const encoded = new URLSearchParams({
      filter: JSON.stringify(q),
    }).toString();
    if (encoded === filterParams) void run(q);
    else setParams({ filter: JSON.stringify(q) });
  }
  async function collect(sourceIds: string[]) {
    if (busy || checkingSourcesRef.current || !sourceIds.length) return;
    setBusy(true);
    setError("");
    try {
      await api.pkiCollect(sourceIds);
      setSourceChecks((checks) => Object.fromEntries(Object.entries(checks).filter(([id]) => !sourceIds.includes(id))));
      setTab("jobs");
      setJobs((await api.pkiJobs()).jobs);
    } catch (e) {
      setError(message(e));
      if (e instanceof AxiosError && e.response?.status === 409) setTab("jobs");
    } finally {
      setBusy(false);
    }
  }
  async function open(c: CertificateRecord) {
    setPemFeedback("");
    setShowSigningCa(false);
    const gen = ++detailGeneration.current;
    setError("");
    try {
      const d = await api.pkiCertificate(c.id);
      if (gen === detailGeneration.current) setDetail(d);
    } catch (e) {
      if (gen === detailGeneration.current) setError(message(e));
    }
  }
  async function jobAction(id: string, action: "pause" | "resume") {
    setActionBusy(true);
    try {
      await api.pkiJobAction(id, action);
      setJobs((await api.pkiJobs()).jobs);
    } catch (e) {
      setError(message(e));
    } finally {
      setActionBusy(false);
    }
  }
  function changeSort(field: PkiQuery["sort"], nextDirection: PkiQuery["direction"] = field === sort && direction === "asc" ? "desc" : "asc") {
    setSort(field); setDirection(nextDirection);
    if (query) setParams({ filter: JSON.stringify({ ...query, sort: field, direction: nextDirection, cursor: undefined, offset: undefined }) });
  }
  function sortHeading(field: PkiQuery["sort"], label: string) {
    return <button className="pki-sort-heading" disabled={busy} onClick={() => changeSort(field)} aria-label={`Sort by ${label}${sort === field ? `, ${direction === "asc" ? "ascending" : "descending"}` : ""}`}>{label}{sort === field ? direction === "asc" ? " ↑" : " ↓" : ""}</button>;
  }
  function exportRecords(exportFormat: "csv" | "json") {
    setExportOpen(false);
    if (!query) return;
    const a = document.createElement("a");
    a.href =
      "/api/pki/export?format=" + exportFormat + "&filter=" +
      encodeURIComponent(JSON.stringify({ ...query, cursor: undefined }));
    a.download = `certificates.${exportFormat}`;
    a.click();
  }
  useEffect(() => {
    if (!ready || tab === "jobs") return;
    void api
      .pkiSources()
      .then((r) => acceptSources(r.sources))
      .catch((e) => setError(message(e)));
  }, [tab, ready]);
  return (
    <div className="pki-workspace">
      <div className="pki-row pki-spread">
        <div>
          <h1>Certificates</h1>
          <p className="pki-muted">
            PKI inventory · collected public certificates
          </p>
        </div>
        <div className="pki-row">
          {tab === "inventory" && (
            <button disabled={busy || !query} onClick={() => query && void run(query)}>
              Refresh results
            </button>
          )}
        <button
          disabled={busy || checkingSources || !sources.length}
          onClick={() => void collect(sources.map((source) => source.id))}
        >
          Collect All Sources
        </button>
        </div>
      </div>
      <nav className="pki-tabs" aria-label="Certificate workspace">
        {[
          ["inventory", "Inventory"],
          ["sources", "Sources"],
          ["jobs", "Collection jobs"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <div className="pki-error" role="alert">
          {error}
        </div>
      )}
      {tab === "inventory" && (
        <>
          <CertificateOverview summary={query ? summary : null} busy={busy} />
          <div className="pki-row pki-spread">
            <span className="pki-muted">
              {
                sources.filter(
                  (s) =>
                    (query?.sources ?? selected).includes(s.id) &&
                    s.coverage === "complete",
                ).length
              }{" "}
              sources completely collected at last observation
            </span>
          </div>
          <CertificateSearch
            advanced={advancedSearch}
            onAdvanced={setAdvancedSearch}
            quickSearch={quickSearch}
            onQuickSearch={setQuickSearch}
            scope={<div className="pki-search-scope">
              <div className="pki-source-field">
                <span>Sources</span>
                <details className="pki-source-picker" ref={sourcePicker} onKeyDown={(event) => {
                  if (event.key === "Escape" && event.currentTarget.open) {
                    event.preventDefault();
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                  }
                }}>
                  <summary className="ui-dropdown-control">
                    <span>{selected.length === sources.length ? `All ${sources.length} sources` : `${selected.length} sources selected`}</span>
                    <DropdownChevron />
                  </summary>
                  <div className="pki-source-options">
                    <label><input type="checkbox" checked={!!sources.length && selected.length === sources.length} onChange={(e) => setSelected(e.target.checked ? sources.map(s => s.id) : [])} />All authorized sources</label>
                    {sources.map(source => <label key={source.id}><input type="checkbox" checked={selected.includes(source.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, source.id] : selected.filter(id => id !== source.id))} />{source.path}{source.namespace ? ` · ${source.namespace}` : ""}</label>)}
                    {!sources.length && <span>No authorized sources</span>}
                  </div>
                </details>
              </div>
            <label>
              Usage type{" "}
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All types</option>
                {Object.entries(labelType).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Validity{" "}
              <select value={valid} onChange={(e) => setValid(e.target.value)}>
                <option value="">Any</option>
                <option value="valid">Currently valid</option>
                <option value="expiring">Expires within 30 days</option>
                <option value="expired">Expired</option>
                <option value="not_yet_valid">Not yet valid</option>
              </select>
            </label>
            <label>
              Revocation{" "}
              <select
                value={revoked}
                onChange={(e) => setRevoked(e.target.value)}
              >
                <option value="">Any</option>
                {Object.entries(labelRevocation).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>

            </div>}
            onReset={() => {
              setSelected(sources.map(s => s.id));
              setType(""); setValid(""); setRevoked("");
              setQuickSearch("");
              setMatch("all"); setConditions([{ ...emptyCondition }]);
            }}
            conditions={conditions}
            onChange={setConditions}
            match={match}
            onMatch={setMatch}
            onSearch={search}
            disabled={busy || !ready}
          />
          {detail && (
            <CertificateDialog onBack={showSigningCa ? () => setShowSigningCa(false) : undefined} title={showSigningCa ? "Issuer certificate" : "Certificate details"} onClose={() => {
                    setDetail(null);
                    detailGeneration.current++;
                  }}>
              {showSigningCa && detail.issuer && detail.issuerCertificate ? (
                <IssuerCertificateView certificate={detail.issuerCertificate} pem={detail.issuer.pem} sourcePath={detail.certificate.sourcePath || detail.certificate.sourceId} />
              ) : <>
              <div className={`pki-detail-status ${certificateExpiry(detail.certificate).tone}`}>
                <div><strong>{certificateExpiry(detail.certificate).label}</strong><span> · {certificateExpiry(detail.certificate).days.replace("d", " days")}</span></div>
                <span className="pki-detail-revocation">{labelRevocation[detail.certificate.revoked]}</span>
              </div>
              <div className="pki-certificate-summary">
                <aside>
                  <dl>
                    <dt>Valid from</dt><dd>{new Date(detail.certificate.notBefore).toISOString().replace("T", " ").replace(".000Z", " UTC")}</dd>
                    <dt>Expires at</dt><dd>{new Date(detail.certificate.notAfter).toISOString().replace("T", " ").replace(".000Z", " UTC")}</dd>
                    <dt>{detail.certificate.notAfter <= Date.now() ? "Time since expiry" : detail.certificate.notBefore > Date.now() ? "Valid in" : "Time remaining"}</dt><dd className={`pki-detail-duration ${certificateExpiry(detail.certificate).tone}`}>{certificateExpiry(detail.certificate).days.replace("in ", "").replace("d", " days")}</dd>
                  </dl>
                </aside>
                <div>
                  <h3>{detail.certificate.cn || detail.certificate.serial}</h3>
                  <dl className="pki-certificate-facts">
                    <div><dt>PKI engine</dt><dd>{detail.certificate.sourcePath || detail.certificate.sourceId}</dd></div>
                    <div><dt>Certificate type</dt><dd>{labelType[detail.certificate.type]}</dd></div>
                    <div><dt>Issuer</dt><dd>{detail.certificate.issuer}</dd></div>
                    <div><dt>Usage</dt><dd>{detail.certificate.eku.map(oid => labelUsage[oid] || oid).join(", ") || "Not specified"}</dd></div>
                    <div><dt>SAN</dt><dd>{detail.certificate.sans.map(s => `${s.type}: ${s.value}`).join("\n") || "None"}</dd></div>
                  </dl>
                </div>
              </div>
              <details className="pki-certificate-technical">
                <summary>Technical details</summary>
              <dl className="pki-detail-grid">
                {[
                  ["Serial", detail.certificate.serial],
                  ["SHA-256", detail.certificate.fingerprint],
                  ["Subject", detail.certificate.subject],
                  ["Issuer", detail.certificate.issuer],
                  ["Issuer evidence", detail.issuerState],
                  ["Role attribution", "Unknown — no issuance evidence"],
                  [
                    "Public key",
                    `${detail.certificate.algorithm} ${detail.certificate.curve || detail.certificate.keySize}`,
                  ],
                  [
                    "Validity",
                    `${date(detail.certificate.notBefore)} → ${date(detail.certificate.notAfter)}`,
                  ],
                  ["Source presence", detail.certificate.presence],
                  ["Last observed", detail.certificate.lastSeen],
                  [
                    "Revocation observed",
                    detail.certificate.revocationObservedAt || "Unknown",
                  ],
                  ["Revocation", labelRevocation[detail.certificate.revoked]],
                  [
                    "SAN",
                    detail.certificate.sans
                      .map((s) => `${s.type}: ${s.value}`)
                      .join("\n") || "None",
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              </details>
              {!!detail.conflicts?.observations.length && (
                <div role="status" className="pki-error">
                  <strong>Certificate identity conflict</strong>
                  <p>
                    The original certificate is retained. Vault returned
                    different content for this source and serial.
                  </p>
                  {detail.conflicts.observations.map((c) => (
                    <p key={c.observedFingerprint}>
                      <code>{c.observedFingerprint}</code>
                      <br />
                      {c.observations} observations · {c.firstSeen} to{" "}
                      {c.lastSeen}
                    </p>
                  ))}
                  {detail.conflicts.truncated && (
                    <p>Only the first 20 conflicts are shown.</p>
                  )}
                </div>
              )}
              <footer className="pki-detail-actions">
                <CertificatePemActions key={detail.certificate.id} pem={detail.pem} serial={detail.certificate.serial} chain={detail.chain} onFeedback={setPemFeedback} />
                <span className="pki-action-spacer" />
                <Link to={pkiEngineUrl(detail.certificate.sourcePath!, { source: detail.certificate.sourceId, certificate: detail.certificate.serial, record: detail.certificate.id })}>View in engine</Link>
                <button disabled={!detail.issuerCertificate} title={detail.issuerCertificate ? "View the verified signing CA" : "Signing CA is unavailable"} onClick={() => setShowSigningCa(true)}>Intermediate CA</button>
              </footer>
              {pemFeedback && <p className="pki-muted" role="status">{pemFeedback}</p>}
              </>}
            </CertificateDialog>
          )}
          <div className="pki-row pki-spread pki-controls">
            <span aria-live="polite">
              {busy
                ? "Loading…"
                : `${total.toLocaleString()} matching certificates · ${(query?.sources.length ?? 0).toLocaleString()} sources`}
            </span>
            <div className="pki-row">
              <label>
                Sort{" "}
                <select
                  value={sort}
                  disabled={busy}
                  onChange={(e) => changeSort(e.target.value as PkiQuery["sort"], direction)}
                >
                  <option value="notAfter">Expiry date</option>
                  <option value="cn">Common name</option>
                  <option value="serial">Serial</option>
                  <option value="sourcePath">Source</option>
                  <option value="type">Usage type</option>
                  <option value="revoked">Revocation</option>
                </select>
              </label>
              <button disabled={busy || !query} onClick={() => changeSort(sort, direction === "asc" ? "desc" : "asc")} aria-label={`Sort ${direction === "asc" ? "descending" : "ascending"}`} title={direction === "asc" ? "Ascending" : "Descending"}>{direction === "asc" ? "↑" : "↓"}</button>
              <div className="pki-export-control" ref={exportControl}
                onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setExportOpen(false); }}
                onKeyDown={event => { if (event.key === "Escape") { setExportOpen(false); exportControl.current?.querySelector("button")?.focus(); } }}>
                <button disabled={!query || busy} aria-expanded={exportOpen} aria-controls="certificate-export-options"
                  onClick={() => setExportOpen(open => !open)} className="pki-export-trigger">
                  Export <DropdownChevron />
                </button>
                {exportOpen && <div id="certificate-export-options" className="pki-export-options" role="group" aria-label="Export format">
                  <button disabled={!query || busy} onClick={() => exportRecords("csv")}>Export CSV</button>
                  <button disabled={!query || busy} onClick={() => exportRecords("json")}>Export JSON</button>
                </div>}
              </div>
            </div>
          </div>
          {sanDetail && <CertificateDialog title="Subject alternative names" onClose={() => setSanDetail(null)}>
            <h3>{sanDetail.cn || sanDetail.serial}</h3>
            <ul className="pki-san-values">{sanDetail.sans.map((san, index) => <li key={`${san.type}:${index}`}><span>{san.type.toUpperCase()}</span> {san.value}</li>)}</ul>
          </CertificateDialog>}
          <div className="pki-box pki-table pki-certificate-list">
            <table>
              <thead>
                <tr>
                  <th className="pki-selection-cell"><input type="checkbox" aria-label="Select certificates on this page" disabled={busy || !rows.length}
                    checked={!!rows.length && checkedOnPage === rows.length}
                    ref={node => { if (node) node.indeterminate = checkedOnPage > 0 && checkedOnPage < rows.length; }}
                    onChange={e => selectCertificates(rows, e.target.checked)} /></th>
                  <th>{sortHeading("cn", "Common name")} / {sortHeading("serial", "serial")} / {sortHeading("type", "type")}</th>
                  <th>SAN</th>
                  <th>{sortHeading("sourcePath", "PKI engine")} / source</th>
                  <th aria-sort={sort === "notAfter" ? direction === "asc" ? "ascending" : "descending" : "none"}>{sortHeading("notAfter", "Validity")}</th>
                  <th>{sortHeading("revoked", "Revocation")}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const source = sources.find(s => s.id === c.sourceId);
                  const sourceName = source ? (clusterInfo?.id === source.cluster ? clusterInfo.name : `Cluster ${source.cluster}`) + (source.namespace ? ` / ${source.namespace}` : "") : "Unknown source";
                  const expiry = certificateExpiry(c);
                  return (
                  <tr key={c.id} onClick={e => { if (busy || (e.target as HTMLElement).closest("button, a, input, select") || window.getSelection()?.toString()) return; selectCertificates([c], !checkedCertificates.has(c.id)); }} className={checkedCertificates.has(c.id) ? "pki-selected-row" : undefined}>
                    <td className="pki-selection-cell"><input type="checkbox" aria-label={`Select ${c.cn || c.serial}`} checked={checkedCertificates.has(c.id)} disabled={busy} onChange={e => selectCertificates([c], e.target.checked)} /></td>
                    <td>
                      <div className="pki-certificate-name"><button className="pki-link" onClick={() => void open(c)}>{c.cn || "(no common name)"}</button>
                        <Link className="pki-engine-link" to={pkiEngineUrl(c.sourcePath!, { source: c.sourceId, certificate: c.serial, record: c.id })}>View in engine</Link>
                      </div>
                      <small className="pki-serial-type" title={c.serial}><span aria-label={`Serial number: ${c.serial}`}>{c.serial.length > 28 ? `${c.serial.slice(0, 14)}…${c.serial.slice(-12)}` : c.serial}</span><span> · {labelType[c.type]}</span></small>
                    </td>
                    <td className="pki-san-cell">
                      {c.sans.length ? <>
                        <button className="pki-san-link" title={c.sans[0].value} onClick={() => setSanDetail(c)}>{c.sans[0].value}</button>
                        <small>{c.sans.length > 1 ? <button className="pki-san-link pki-san-more" onClick={() => setSanDetail(c)}>+{c.sans.length - 1} more</button> : c.sans[0].type.toUpperCase()}</small>
                      </> : <span className="pki-muted">—</span>}
                    </td>
                    <td className="pki-source-cell">
                      <span className="pki-engine-name" title={c.sourcePath}>{c.sourcePath}</span>
                      <small title={sourceName}>{sourceName}</small>
                    </td>
                    <td>
                      <div className={`pki-expiry-state ${expiry.tone}`}>
                        <span className="pki-expiry-label">{expiry.label}</span><span>{expiry.days}</span>
                      </div>
                      <small>{new Date(c.notAfter).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</small>
                    </td>
                    <td>
                      {labelRevocation[c.revoked]}
                      {c.presence === "not_observed" && (
                        <small>
                          Not observed in latest complete collection
                        </small>
                      )}
                    </td>
                    <td><button className="pki-details-button" type="button" onClick={() => void open(c)} aria-label={`Details for ${c.cn || c.serial}`}>Details</button></td>
                  </tr>
                ); })}
                {!rows.length && (
                  <tr>
                    <td colSpan={7}>
                      {ready
                        ? "No matching certificates. Select sources and collect them, or change the search."
                        : "Loading sources…"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <CertificatePagination page={page} size={pageSize} total={total} disabled={busy || !query}
            onPage={(target) => query && void run({ ...query, cursor: undefined, offset: (target - 1) * pageSize })}
            onSize={(size) => {
              if (query) void run({ ...query, cursor: undefined, offset: 0, limit: size });
            }} />
          <CertificateBatchControls total={total} key={selectionScope} selected={checkedCertificates} onSelection={setCheckedCertificates} query={query} disabled={busy}
            onChanged={() => { if (query) void run(query); }} />
        </>
      )}
      {tab === "sources" && (
        <>
          <div className="pki-box">
            <h2>Authorized PKI sources</h2>
            <div className="pki-row">
              <button
                disabled={busy || checkingSources || !selected.length}
                onClick={() => void collect(selected)}
              >
                Collect Selected
              </button>
              <button
                disabled={checkingSources}
                onClick={() =>
                  void api
                    .pkiSources()
                    .then((r) => { setSourceChecks({}); acceptSources(r.sources); })
                    .catch((e) => setError(message(e)))
                }
              >
                Refresh Source List
              </button>
              <button disabled={busy || checkingSources || !sources.length} onClick={() => void checkSources()}>
                {checkingSources ? "Comparing…" : "Compare with Vault"}
              </button>
            </div>
            <details className="pki-source-actions-help">
              <summary>What do these actions do?</summary>
              <dl>
                <dt>Collect Selected</dt>
                <dd>Fetch certificates from selected sources.</dd>
                <dt>Refresh Source List</dt>
                <dd>Reload available PKI engines and clear comparison results.</dd>
                <dt>Compare with Vault</dt>
                <dd>Compare stored serial numbers with Vault. Results are cached for 2 minutes.</dd>
              </dl>
            </details>
            <p className="pki-muted pki-source-comparison-note">
              Comparison checks stored serial numbers only, not revocation changes.
            </p>
            <div className="pki-table">
              <table className="pki-sources-table">
                <colgroup>
                  <col style={{ width: "4%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "19%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "12%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all sources"
                        title="Select all sources"
                        disabled={!sources.length}
                        checked={sources.length > 0 && sources.every((source) => selected.includes(source.id))}
                        ref={(node) => {
                          if (node) node.indeterminate = sources.some((source) => selected.includes(source.id))
                            && !sources.every((source) => selected.includes(source.id));
                        }}
                        onChange={(e) => setSelected(e.target.checked ? sources.map((source) => source.id) : [])}
                      />
                    </th>
                    <th>Mount / namespace</th>
                    <th><abbr title="Completeness of the last collection. Certificates issued with no_store are not included.">Coverage</abbr></th>
                    <th>Records</th>
                    <th>Comparison</th>
                    <th>Last collection</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Include ${s.path}`}
                          checked={selected.includes(s.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, s.id]
                                : selected.filter((id) => id !== s.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        {s.path}
                        <small>{s.namespace || "root namespace"}</small>
                        <details>
                          <summary>Source identity</summary>
                          <small>
                            Cluster: {s.cluster}
                            <br />
                            Accessor: {s.accessor}
                          </small>
                        </details>
                      </td>
                      <td>
                        {s.coverage.replace(/_/g, " ")}
                        <small>
                          {coverageText[s.coverage] ||
                            "Observation incomplete; inspect the collection job."}
                        </small>
                      </td>
                      <td>
                        Local: {sourceChecks[s.id]?.result?.localCount ?? s.certificateCount ?? 0}
                        <small>Vault: {sourceChecks[s.id]?.checking ? "Checking…" : sourceChecks[s.id]?.error ? "Unavailable" : sourceChecks[s.id]?.result?.vaultCount ?? "Not checked"}</small>
                      </td>
                      <td>
                        {sourceChecks[s.id]?.result ? <>
                          <span className={sourceChecks[s.id].result!.notCollected ? "pki-source-difference" : undefined}>
                            Not collected: {sourceChecks[s.id].result!.notCollected}
                          </span>
                          <small><abbr title="Stored locally but absent from the retrieved Vault list. These records are not automatically deleted.">Local only</abbr>: {sourceChecks[s.id].result!.localOnly}</small>
                          <small><abbr title="Time of the serial-number comparison, separate from the last certificate collection.">Checked</abbr> {new Date(sourceChecks[s.id].result!.checkedAt).toLocaleString()}</small>
                        </> : <span>{sourceChecks[s.id]?.checking ? "Checking…" : sourceChecks[s.id]?.error || "Not checked"}</span>}
                      </td>
                      <td>
                        {s.lastCollected ? new Date(s.lastCollected).toLocaleString() : "Never collected"}
                      </td>
                      <td>
                        <button
                          disabled={busy || checkingSources}
                          className={sourceChecks[s.id]?.result?.notCollected ? "pki-source-collect-needed" : undefined}
                          aria-label={`Run Collection for ${s.path}${s.namespace ? ` in ${s.namespace}` : ""}`}
                          onClick={() => void collect([s.id])}
                        >
                          Run Collection
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!sources.length && (
              <p>No PKI mounts with certificate-list access were discovered.</p>
            )}
          </div>

        </>
      )}
      {tab === "jobs" && (
        <>
          <div className="pki-row pki-spread pki-jobs-heading">
            <h2>Collection history</h2>
            <span className="pki-muted">{jobs.length} jobs · newest first</span>
          </div>
          <details className="pki-jobs-help">
            <summary>About collection jobs</summary>
            <p>Only one collection can be active. Pause stops at a safe request boundary.
              Resume uses your current Vault session, retries failed and pending items,
              and rereads completed certificates to refresh revocation and identity evidence.</p>
          </details>
          {jobs.length > 0 && <div className="pki-table pki-jobs-table">
            <table>
              <thead><tr>
                <th>Started</th><th>Status</th><th>Sources</th>
                <th className="pki-job-number">Processed</th>
                <th className="pki-job-number">Failed</th><th>Actions</th>
              </tr></thead>
              <tbody>{jobs.map((j) => (
                <Fragment key={j.id}>
                  <tr>
                    <td className="pki-job-started">
                      <time dateTime={j.createdAt} title={new Date(j.createdAt).toLocaleString()}>
                        {new Date(j.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </td>
                    <td>
                      <span className={`pki-job-status pki-job-status-${j.status}`}>
                        {j.status.replace(/_/g, " ")}
                      </span>
                      {j.error && <small className="pki-job-error">{j.error}</small>}
                    </td>
                    <td className="pki-job-scope">
                      {j.sources.length === 1
                        ? sources.find((s) => s.id === j.sources[0])?.path ?? j.sources[0]
                        : `${j.sources.length} sources`}
                    </td>
                    <td className="pki-job-number">
                      {j.completed.toLocaleString()} / {j.total.toLocaleString()}
                      {["queued", "running", "pausing"].includes(j.status) && <progress
                        className="pki-job-progress" aria-label="Collection progress"
                        value={j.completed + j.failed} max={Math.max(j.total, 1)} />}
                    </td>
                    <td className={`pki-job-number${j.failed ? " pki-job-error" : ""}`}>{j.failed.toLocaleString()}</td>
                    <td><div className="pki-row pki-job-actions">
                      <button aria-expanded={expandedJob === j.id}
                        aria-controls={`job-details-${j.id}`}
                        aria-label={`${expandedJob === j.id ? "Hide" : "Show"} details for collection ${new Date(j.createdAt).toLocaleString()}`}
                        onClick={() => setExpandedJob(expandedJob === j.id ? null : j.id)}>
                        {expandedJob === j.id ? "Hide" : "Details"}
                      </button>
                      {["queued", "running"].includes(j.status) && <button disabled={actionBusy}
                        onClick={() => void jobAction(j.id, "pause")}>Pause</button>}
                      {["paused", "partial", "interrupted"].includes(j.status) && <button disabled={actionBusy}
                        onClick={() => void jobAction(j.id, "resume")}>Resume</button>}
                    </div></td>
                  </tr>
                  {expandedJob === j.id && <tr id={`job-details-${j.id}`} className="pki-job-details-row">
                    <td colSpan={6}><CollectionProgress id={j.id} updatedAt={j.updatedAt} /></td>
                  </tr>}
                </Fragment>
              ))}</tbody>
            </table>
          </div>}
          {jobs.length > 0 && <p className="pki-muted pki-jobs-timezone">
            Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>}
          {!jobs.length && (
            <div className="pki-box">No collection jobs yet.</div>
          )}
        </>
      )}
    </div>
  );
}
