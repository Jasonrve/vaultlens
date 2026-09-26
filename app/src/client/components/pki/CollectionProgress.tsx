import { useEffect, useState } from "react";
import { pkiJobDetails } from "../../lib/api";
import type { PkiJobDetails } from "../../../shared/pki";
export default function CollectionProgress({
  id,
  updatedAt,
}: {
  id: string;
  updatedAt: string;
}) {
  const [details, setDetails] = useState<PkiJobDetails | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void pkiJobDetails(id)
      .then((d) => {
        if (active) {
          setDetails(d);
          setError("");
        }
      })
      .catch(() => {
        if (active) {
          setDetails(null);
          setError(
            "Job details are unavailable. Refresh the session and source access.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [id, updatedAt]);
  if (error) return <p role="alert">{error}</p>;
  if (!details) return <p role="status">Loading source progress…</p>;
  return (
    <div>
      <p className="pki-muted">
        Attempt {details.job.attempt} · {details.job.concurrency} concurrent
        requests · {details.job.requestsPerSecond} requests/s
      </p>
      <div className="pki-table pki-job-source-progress">
        <table>
          <thead><tr><th>Source</th><th>Status / evidence</th>
            <th className="pki-job-number">Read</th><th className="pki-job-number">Pending</th>
            <th className="pki-job-number">Failed</th></tr></thead>
          <tbody>{details.sources.map((s) => (
            <tr key={s.sourceId}>
              <td className="pki-job-scope">{s.path}<small>{s.namespace || "root namespace"}</small></td>
              <td>
                {s.status.replace(/_/g, " ")}
                <small>Revocation: {s.revocationMode.replace(/_/g, " ")}</small>
                {s.revocationError && <small>{s.revocationError}. Certificate metadata is used where available.</small>}
                {s.error && <small className="pki-job-error" role="status">{s.errorCategory}: {s.error}</small>}
              </td>
              <td className="pki-job-number">{s.completed.toLocaleString()} / {s.total.toLocaleString()}</td>
              <td className="pki-job-number">{s.pending.toLocaleString()}</td>
              <td className={`pki-job-number${s.failed ? " pki-job-error" : ""}`}>{s.failed.toLocaleString()}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {details.errors.length > 0 && (
        <div>
          <h3>Certificate errors</h3>
          {details.errors.map((e) => (
            <p key={e.sourceId + e.serial}>
              <code>{e.serial}</code> · {e.errorCategory}: {e.error}
            </p>
          ))}
          {details.errorsTruncated && (
            <p>
              Showing the first 20 errors. Full failure counts appear above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
