import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AxiosError } from "axios";
import type { PkiQuery } from "../../../shared/pki";
import type { PkiBatchAction, PkiBatchRef, PkiBatchPreview } from "../../../shared/pkiBatch";
import * as api from "../../lib/api";
import CertificateDialog from "./CertificateDialog";

const titles = { export: "Export PEM", revoke: "Revoke certificates", remove: "Remove from inventory" };
const errorText = (e: unknown) => e instanceof AxiosError ? e.response?.data?.error || e.message : e instanceof Error ? e.message : "Operation failed";
export default function CertificateBatchControls({ selected, onSelection, query, total, disabled, onChanged }: {
  selected: Map<number, PkiBatchRef>;
  onSelection: (value: Map<number, PkiBatchRef>) => void;
  query: PkiQuery | null;
  total: number;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [showSelected, setShowSelected] = useState(false);
  const [selectionPage, setSelectionPage] = useState(1);
  const [dock, setDock] = useState<HTMLElement | null>(null);
  useEffect(() => { setDock(document.getElementById("page-action-dock")); }, []);
  const [action, setAction] = useState<PkiBatchAction | null>(null);
  const [items, setItems] = useState<PkiBatchPreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [results, setResults] = useState<{ certificate: PkiBatchRef; status: string }[] | null>(null);
  const stop = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; }; }, []);
  function exportCsv() {
    // Quote all cells and neutralize spreadsheet formulas in certificate-controlled text.
    const cell = (value: string) => '"' + (/^[\s]*[=+@-]/.test(value) ? "'" + value : value).replace(/"/g, '""') + '"';
    const lines = [["Common name", "Serial number", "Source", "Source ID", "SHA-256 fingerprint"],
      ...Array.from(selected.values(), c => [c.cn, c.serial, c.sourcePath || "", c.sourceId, c.fingerprint])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + lines.map(row => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `selected-certificates-${selected.size}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function selectAll() {
    if (!query) return;
    setBusy(true); setError("");
    try {
      const result = await api.pkiSelectCertificates(query);
      if (alive.current) onSelection(new Map(result.certificates.map(c => [c.id, c])));
    } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function preview(next: PkiBatchAction) {
    setAction(next); setItems([]); setResults(null); setConfirmation(""); setError(""); setBusy(true);
    const refs = [...selected.values()];
    const all: PkiBatchPreview[] = [];
    try {
      for (let i = 0; i < refs.length && alive.current; i += 200) {
        all.push(...(await api.pkiBatchPreview(next, refs.slice(i, i + 200))).items);
      }
      if (alive.current) setItems(all);
    } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function execute() {
    if (!action) return;
    setBusy(true); setError(""); stop.current = false;
    const report: { certificate: PkiBatchRef; status: string }[] = [];
    const pems: string[] = [];
    const remaining = new Map(selected);
    setResults([]);
    for (const item of items) {
      if (stop.current || !alive.current) break;
      let status = "Skipped: " + item.reason;
      if (item.eligible) {
        try {
          const result = await api.pkiBatchItem(action, item.certificate);
          status = result.status;
          if (result.pem) pems.push(result.pem);
          remaining.delete(item.certificate.id);
        } catch (e) { status = "Failed: " + errorText(e); }
      }
      report.push({ certificate: item.certificate, status });
      if (alive.current) setResults([...report]);
    }
    if (pems.length && alive.current) {
      const url = URL.createObjectURL(new Blob([pems.join("\n")], { type: "application/x-pem-file" }));
      const link = document.createElement("a"); link.href = url;
      link.download = `certificates-${pems.length}${pems.length < items.filter(i => i.eligible).length ? "-partial" : ""}.pem`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (alive.current) {
      setBusy(false); onSelection(remaining);
      if (action !== "export") onChanged();
    }
  }
  const eligible = items.filter(i => i.eligible).length;
  const selectionPages = Math.max(1, Math.ceil(selected.size / 50));
  const currentSelectionPage = Math.min(selectionPage, selectionPages);
  const selectedRows = [...selected.values()].slice((currentSelectionPage - 1) * 50, currentSelectionPage * 50);
  if (!selected.size && !action && !showSelected) return null;
  const selectionBar = selected.size > 0 && <div className="pki-workspace pki-selection-dock">
    <div className="pki-batch-bar" role="region" aria-label="Selected certificates">
      <div className="pki-batch-selection">
        <strong>{selected.size.toLocaleString()} selected</strong>
        <div className="pki-batch-selection-tools" role="group" aria-label="Manage selection">
          <button disabled={disabled || busy || !query} onClick={() => void selectAll()}>Select all {total.toLocaleString()} </button>
          <span aria-hidden="true">·</span>
          <button disabled={busy} onClick={() => onSelection(new Map())}>Clear</button>
        </div>
      </div>
      <div className="pki-batch-actions" role="group" aria-label="Certificate actions">
        <button disabled={disabled || busy} onClick={() => { setSelectionPage(1); setShowSelected(true); }}>Show selected</button>
        <button disabled={disabled || busy} onClick={exportCsv}>Export CSV</button>
        <span className="pki-batch-action-divider" aria-hidden="true" />
        <button disabled={disabled || busy} onClick={() => void preview("revoke")}>Revoke…</button>
        <button disabled={disabled || busy} onClick={() => void preview("remove")}>Remove from inventory…</button>
      </div>
    </div>
    {error && !action && <p className="pki-error" role="alert">{error}</p>}
  </div>;
  return <>
    {dock ? createPortal(selectionBar, dock) : selectionBar}
    {showSelected && <CertificateDialog title="Selected certificates" onClose={() => setShowSelected(false)}>
      <p className="pki-muted">{selected.size.toLocaleString()} selected across all pages</p>
      <div className="pki-batch-preview"><table><thead><tr><th>Selected</th><th>Common name / serial</th><th>Source</th></tr></thead><tbody>
        {selectedRows.map(c => <tr key={c.id}>
          <td><input type="checkbox" checked aria-label={`Keep ${c.cn || c.serial} selected`} onChange={() => { const next = new Map(selected); next.delete(c.id); onSelection(next); }} /></td>
          <td>{c.cn || "—"}<small>{c.serial}</small></td><td>{c.sourcePath || c.sourceId}</td>
        </tr>)}
        {!selected.size && <tr><td colSpan={3}>No certificates selected.</td></tr>}
      </tbody></table></div>
      <div className="pki-row pki-spread">
        <span className="pki-muted">Page {currentSelectionPage} / {selectionPages}</span>
        <div className="pki-row">
          <button disabled={currentSelectionPage === 1} onClick={() => setSelectionPage(currentSelectionPage - 1)}>Previous</button>
          <button disabled={currentSelectionPage === selectionPages} onClick={() => setSelectionPage(currentSelectionPage + 1)}>Next</button>
        </div>
      </div>
    </CertificateDialog>}
    {action && <CertificateDialog title={titles[action]} busy={busy} onClose={() => setAction(null)}>
      <p className="pki-muted">{action === "revoke" ? "Revocation cannot be undone. Permissions and live certificate identity are checked again before each request." : action === "remove" ? "Removes local inventory records only. Certificates in Vault remain unchanged and may be collected again. VaultLens admin privileges are required." : "Download the selected public certificates in one PEM bundle."}</p>
      {error && <p className="pki-error" role="alert">{error}</p>}
      <p role="status">{results ? `${results.length} of ${items.length} processed${busy ? "…" : ""}` : busy ? "Checking selected certificates…" : `${eligible} eligible · ${items.length - eligible} skipped`}</p>
      <div className="pki-batch-preview"><table><thead><tr><th>Certificate / source</th><th>{results ? "Result" : "Eligibility"}</th></tr></thead><tbody>
        {(results ?? items.map(i => ({ certificate: i.certificate, status: i.eligible ? "Eligible" : i.reason }))).map(item => <tr key={item.certificate.id}><td>{item.certificate.cn || item.certificate.serial}<small>{item.certificate.sourcePath}</small></td><td>{item.status}</td></tr>)}
      </tbody></table></div>
      {!results && action !== "export" && <label className="pki-batch-confirm">Type {action.toUpperCase()} to confirm<input value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} autoComplete="off" /></label>}
      <div className="pki-row">
        {!results && <button className="pki-batch-danger" disabled={busy || !eligible || (action !== "export" && confirmation !== action.toUpperCase())} onClick={() => void execute()}>{action === "export" ? "Download" : "Confirm"} {eligible} certificates</button>}
        {results && busy && <button onClick={() => { stop.current = true; }}>Stop after current certificate</button>}
        {results && !busy && <p className="pki-muted">Failed, skipped and unprocessed certificates remain selected.</p>}
      </div>
    </CertificateDialog>}
  </>;
}
