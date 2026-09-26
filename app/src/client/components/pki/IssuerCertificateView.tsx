import { useState } from "react";
import type { IssuerCertificateInfo } from "../../../shared/pkiPem";

const utc = (value: number) => new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC");
export default function IssuerCertificateView({ certificate: c, pem, sourcePath }: {
  certificate: IssuerCertificateInfo; pem: string; sourcePath: string;
}) {
  const [feedback, setFeedback] = useState("");
  const key = [c.algorithm, c.curve || (c.keySize ? `${c.keySize} bits` : "")].filter(Boolean).join(" · ");
  const now = Date.now();
  const expired = c.notAfter <= now;
  const pending = !expired && c.notBefore > now;
  const warning = !expired && !pending && c.notAfter - now <= 30 * 86400000;
  const tone = expired ? "expired" : pending ? "pending" : warning ? "warning" : "valid";
  const label = expired ? "Expired" : pending ? "Not yet valid" : warning ? "Expiring" : "Valid";
  const days = expired ? Math.floor((now - c.notAfter) / 86400000) : Math.ceil(((pending ? c.notBefore : c.notAfter) - now) / 86400000);
  async function exportPem(copy: boolean) {
    try {
      if (copy) {
        await navigator.clipboard.writeText(pem.trim() + "\n");
        setFeedback("Issuer certificate copied to clipboard");
      } else {
        const url = URL.createObjectURL(new Blob([pem.trim() + "\n"], { type: "application/x-pem-file" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${c.serial}-ca.pem`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setFeedback("Issuer certificate downloaded");
      }
    } catch { setFeedback(`Could not ${copy ? "copy" : "download"} PEM. Please try again.`); }
  }
  return <>
    <div className={`pki-detail-status ${tone}`}>
      <div><strong>{label}</strong><span> · {days} days {expired ? "since expiry" : pending ? "until valid" : "remaining"}</span></div>
      <span className="pki-detail-revocation">Revocation unknown</span>
    </div>
    <div className="pki-certificate-summary">
      <aside>
        <dl>
          <dt>Valid from</dt><dd>{utc(c.notBefore)}</dd>
          <dt>Expires at</dt><dd>{utc(c.notAfter)}</dd>
          <dt>{expired ? "Time since expiry" : pending ? "Valid in" : "Time remaining"}</dt>
          <dd className={`pki-detail-duration ${tone}`}>{days} days</dd>
        </dl>
      </aside>
      <div>
        <h3>{c.subject}</h3>
        <dl className="pki-certificate-facts">
          <div><dt>PKI engine</dt><dd>{sourcePath}</dd></div>
          <div><dt>Certificate type</dt><dd>{c.root ? "Root CA" : "Intermediate CA"}</dd></div>
          <div><dt>Issuer</dt><dd>{c.issuer}</dd></div>
          <div><dt>Public key</dt><dd>{key}</dd></div>
          <div><dt>SAN</dt><dd>{c.sans.map(s => `${s.type}: ${s.value}`).join("\n") || "None"}</dd></div>
        </dl>
      </div>
    </div>
    <details className="pki-certificate-technical">
      <summary>Technical details</summary>
      <dl className="pki-detail-grid">
        {[["Serial", c.serial], ["SHA-256", c.fingerprint], ["Subject", c.subject], ["Issuer", c.issuer]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </details>
    <footer className="pki-detail-actions">
      <button type="button" onClick={() => void exportPem(false)}>Download PEM</button>
      <button type="button" onClick={() => void exportPem(true)}>Copy PEM</button>
    </footer>
    {feedback && <p role="status" className="pki-muted">{feedback}</p>}
  </>;
}
