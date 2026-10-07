import { auditPollingInterval } from '../lib/requestBackoff';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import AuditExportButton from '../components/AuditExportButton';
import { getSecurityAuditRun, getSecurityAuditRuns } from '../lib/api';
import { SEVERITIES } from '../../shared/auditRules';

export default function AuditReportsPage() {
  const [params, setParams] = useSearchParams();
  const runs = useQuery({
    queryKey: ['security-audit-runs'],
    queryFn: getSecurityAuditRuns,
    refetchInterval: (query) => auditPollingInterval(!!query.state.data?.some((run) => run.status === 'running')),
  });
  const available =
    runs.data?.filter((run) =>
      ['completed', 'partial', 'collected'].includes(run.status),
    ) ?? [];
  const runId = params.get('run') || available[0]?.id || '';
  const detail = useQuery({
    queryKey: ['security-audit-run', runId],
    queryFn: () => getSecurityAuditRun(runId),
    enabled: !!runId,
    refetchInterval: (query) =>
      query.state.data?.run.status === 'running' ? auditPollingInterval(true) : false,
  });
  const report = detail.data;
  const ready =
    report?.snapshot &&
    ['completed', 'partial', 'collected'].includes(report.run.status);
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Reports</h2>
      <p className="text-sm text-gray-500">
        Review and download reports from saved audit runs. Downloads use the
        selected run’s original findings and settings.
      </p>
      {runs.isPending && <p>Loading reports…</p>}
      {runs.error && (
        <p role="alert" className="text-sm text-red-700">
          Could not load available reports.
        </p>
      )}
      {(available.length > 0 || runId) && (
        <label className="block text-sm">
          Report source
          <select
            className="mt-1 block w-full rounded border p-2"
            value={runId}
            onChange={(event) => setParams({ run: event.target.value })}
          >
            {runId && !available.some((run) => run.id === runId) && (
              <option value={runId}>{runId}</option>
            )}
            {available.map((run) => (
              <option key={run.id} value={run.id}>
                {new Date(run.startedAt).toLocaleString()} · {run.status} ·{' '}
                {run.findingCount} findings · {run.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      )}
      {!runs.isPending && !runs.error && !runId && (
        <p className="rounded border p-4 text-sm">
          No saved reports yet.{' '}
          <Link
            className="text-blue-700 underline"
            to="/security-audit/sources"
          >
            Collect or import a snapshot
          </Link>{' '}
          to get started.
        </p>
      )}
      {runId && detail.isPending && <p>Loading report summary…</p>}
      {detail.error && (
        <p role="alert" className="text-sm text-red-700">
          Could not load the selected report. Choose another run.
        </p>
      )}
      {report && (
        <>
          <div className="space-y-3 rounded border p-4">
            <h3 className="font-medium">Report summary</h3>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-gray-500">Vault</dt>
                <dd className="break-all">{report.run.target}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Status</dt>
                <dd>{report.run.status}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Created</dt>
                <dd>{new Date(report.run.startedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Settings revision</dt>
                <dd>{report.configuration?.revision ?? 'Unavailable'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Resources</dt>
                <dd>{report.run.resourceCount}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Coverage gaps</dt>
                <dd>{report.run.issueCount}</dd>
              </div>
            </dl>
            {report.run.issueCount > 0 && (
              <p className="text-sm text-amber-800">
                Coverage is incomplete. Missing data does not mean a check
                passed.
              </p>
            )}
            {report.snapshot?.analysisPerformed === false ? (
              <p className="text-sm text-gray-500">
                This snapshot has not been analyzed yet.
              </p>
            ) : (
              <>
                <p className="text-sm">
                  {report.findings.length} findings ·{' '}
                  {report.findingControls?.filter(
                    (control) => control?.suppressed,
                  ).length ?? 0}{' '}
                  excluded in this run
                </p>
                <div className="flex flex-wrap gap-4 text-sm">
                  {SEVERITIES.map((severity) => (
                    <span key={severity}>
                      {severity}:{' '}
                      {
                        report.findings.filter(
                          (finding) => finding.severity === severity,
                        ).length
                      }
                    </span>
                  ))}
                </div>
              </>
            )}
            <Link
              className="inline-block text-sm text-blue-700 underline"
              to={`/security-audit/findings?${new URLSearchParams({ run: runId })}`}
            >
              View findings and evidence
            </Link>
          </div>
          {ready ? (
            <AuditExportButton key={runId} runId={runId} />
          ) : (
            <p className="text-sm text-gray-500">
              A finished snapshot is required to download a report.
            </p>
          )}
        </>
      )}
    </section>
  );
}
