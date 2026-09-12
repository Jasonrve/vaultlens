import AuditObjectLink from './AuditObjectLink';
import Pager, { AuditPageSize } from './AuditPagination';
import AuditDisclosureIcon from './AuditDisclosureIcon';
import AuditFindingReason, {
  AuditFindingTechnicalDetails,
} from './AuditFindingReason';
import AuditPolicyAssignments from './AuditPolicyAssignments';
import { policyUsage, type PolicyUsage } from '../../shared/policyUsage';
import AuditExceptionForm from './AuditExceptionForm';
import { useCallback, useMemo, useState } from 'react';
import { SEVERITIES } from '../../shared/auditRules';
import { CHECK_GROUPS, checkGroup } from '../../shared/auditCheckGroups';
import {
  groupAuditFindings,
  type FindingGrouping,
} from '../../shared/auditFindingGroups';
import type {
  AuditDetail,
  AuditFinding,
  AuditControls,
} from '../../shared/securityAudit';

type FindingControl = AuditControls['states'][number] | null;
function Evidence({
  finding,
  control,
  usage,
}: {
  finding: AuditFinding;
  control: FindingControl;
  usage?: PolicyUsage;
}) {
  return (
    <div className="space-y-3 py-3 text-sm">
      <AuditFindingReason finding={finding} />
      {finding.matchedBlock && (
        <details>
          <summary className="audit-disclosure-summary">
            <AuditDisclosureIcon level="detail" />
            <span>
              Matched policy block
              {finding.line ? ` · line ${finding.line}` : ''}
            </span>
          </summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-xs">
            {finding.matchedBlock}
          </pre>
        </details>
      )}
      {usage && <AuditPolicyAssignments usage={usage} />}
      {!!finding.relatedObjects?.length && (
        <details>
          <summary className="audit-disclosure-summary">
            <AuditDisclosureIcon level="detail" />
            <span>Related resources · {finding.relatedObjects.length}</span>
          </summary>
          <ul className="mt-2 space-y-2 rounded bg-gray-50 p-3 font-mono text-xs">
            {finding.relatedObjects.map((object, index) => (
              <li key={index} className="break-words [overflow-wrap:anywhere]">
                {object.kind} ·{' '}
                <AuditObjectLink
                  path={object.path}
                  namespace={finding.namespace ?? ''}
                />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Links open the current resource in a new tab, not its saved
            snapshot.
            {finding.namespace
              ? ' Direct links are unavailable for this namespace.'
              : ' Resources may have changed or been deleted since collection.'}
          </p>
        </details>
      )}
      <AuditFindingTechnicalDetails evidence={finding.evidence} />
      {finding.recommendation && (
        <section
          aria-label="Recommendation"
          className="rounded-lg border border-blue-200 bg-blue-50 p-4"
        >
          <h4 className="flex items-center gap-2 text-sm font-semibold text-blue-900">
            <svg
              aria-hidden="true"
              focusable="false"
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18h6m-5 3h4M8.1 14.5a6 6 0 1 1 7.8 0c-.6.5-.9 1.1-.9 1.5H9c0-.4-.3-1-.9-1.5Z" />
            </svg>
            Recommendation
          </h4>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-blue-950">
            {finding.recommendation}
          </p>
        </section>
      )}
      {control?.exception && (
        <div className="rounded border border-blue-200 bg-blue-50 p-3">
          <h4 className="font-medium">Exception applied to this run</h4>
          <p>{control.exception.reason}</p>
          <p className="mt-1 text-xs">
            Owner: {control.exception.owner} · Expires:{' '}
            {control.exception.expires}
          </p>
          <p className="mt-1 break-all text-xs">
            {control.exception.id} · {control.exception.object_path}
          </p>
        </div>
      )}
    </div>
  );
}
function FindingRows({
  findings,
  size,
  controls,
  statusOf,
  detail,
  usages,
}: {
  usages: Map<string, PolicyUsage>;
  detail: AuditDetail;
  findings: AuditFinding[];
  size: number;
  controls: Map<AuditFinding, FindingControl>;
  statusOf: (finding: AuditFinding) => string;
}) {
  const [requested, setPage] = useState(1),
    page = Math.min(requested, Math.max(1, Math.ceil(findings.length / size)));
  return (
    <div className="px-4">
      {findings.slice((page - 1) * size, page * size).map((finding, index) => (
        <details
          key={`${page}:${index}`}
          className="border-t border-slate-200 py-3"
        >
          <summary className="audit-disclosure-summary text-sm">
            <AuditDisclosureIcon level="finding" />
            <span className="min-w-0">
              <span className="mr-2 inline-block w-16 text-center text-xs font-medium">
                {finding.severity}
              </span>
              <span className="break-all font-mono text-xs">
                {finding.namespace || 'root'} · {finding.path}
              </span>
              <span className="ml-2 text-xs text-gray-500">
                {finding.ruleId} · {statusOf(finding)}
              </span>
            </span>
          </summary>
          <Evidence
            finding={finding}
            control={controls.get(finding) ?? null}
            usage={usages.get(
              JSON.stringify([finding.namespace ?? '', finding.path]),
            )}
          />
          {['completed', 'partial'].includes(detail.run.status) && (
            <AuditExceptionForm
              runId={detail.run.id}
              index={detail.findings.indexOf(finding)}
              finding={finding}
            />
          )}
        </details>
      ))}
      <Pager
        page={page}
        total={findings.length}
        size={size}
        onChange={setPage}
      />
    </div>
  );
}
export default function AuditFindings({ detail }: { detail: AuditDetail }) {
  const usages = useMemo(() => {
    const result = new Map<string, PolicyUsage>();
    if (!detail.snapshot) return result;
    const byName = new Map(
      policyUsage(detail.snapshot).map((row) => [
        JSON.stringify([row.namespace, row.name]),
        row,
      ]),
    );
    for (const resource of detail.snapshot.resources) {
      if (resource.kind !== 'policy' || typeof resource.data.name !== 'string')
        continue;
      const usage = byName.get(
        JSON.stringify([resource.namespace ?? '', resource.data.name]),
      );
      if (usage)
        result.set(
          JSON.stringify([resource.namespace ?? '', resource.path]),
          usage,
        );
    }
    return result;
  }, [detail.snapshot]);
  const [status, setStatus] = useState('all');
  const controls = useMemo(
    () =>
      new Map(
        detail.findings.map((finding, index) => [
          finding,
          detail.findingControls?.[index] ?? null,
        ]),
      ),
    [detail.findings, detail.findingControls],
  );
  const statusOf = useCallback(
    (finding: AuditFinding) =>
      controls.get(finding)?.suppressed
        ? 'Excluded'
        : detail.snapshot?.controls && !controls.get(finding)
          ? 'Unknown'
          : 'Open',
    [controls, detail.snapshot?.controls],
  );
  const [query, setQuery] = useState(''),
    [severity, setSeverity] = useState('all'),
    [namespace, setNamespace] = useState('all'),
    [category, setCategory] = useState('all');
  const [grouping, setGrouping] = useState<FindingGrouping>('check'),
    [size, setSize] = useState(10),
    [requested, setPage] = useState(1),
    [expanded, setExpanded] = useState<string | null>(null);
  const ruleCategories = useMemo(
    () =>
      new Map(
        detail.configuration?.catalog?.map((rule) => [
          rule.id,
          rule.source === 'builtin' ? checkGroup(rule) : 'Legacy custom',
        ]) ?? [],
      ),
    [detail.configuration],
  );
  const namespaces = useMemo(
    () => [...new Set(detail.findings.map((f) => f.namespace ?? ''))].sort(),
    [detail.findings],
  );
  const matched = useMemo(
    () =>
      detail.findings.filter(
        (f) =>
          (status === 'all' || statusOf(f) === status) &&
          (severity === 'all' || f.severity === severity) &&
          (namespace === 'all' || (f.namespace ?? '') === namespace) &&
          (category === 'all' || ruleCategories.get(f.ruleId) === category) &&
          [f.path, f.title, f.ruleId, f.namespace ?? ''].some((text) =>
            text.toLowerCase().includes(query.toLowerCase()),
          ),
      ),
    [
      detail.findings,
      severity,
      namespace,
      category,
      query,
      ruleCategories,
      status,
      statusOf,
    ],
  );
  const groups = useMemo(
    () => groupAuditFindings(matched, grouping),
    [matched, grouping],
  );
  const page = Math.min(
    requested,
    Math.max(1, Math.ceil(groups.length / size)),
  );
  function reset() {
    setPage(1);
    setExpanded(null);
  }
  const filters = [
    {
      label: 'Status',
      value: status,
      change: setStatus,
      options: ['Open', 'Excluded', 'Unknown'].map((x) => [x, x]),
    },
    {
      label: 'Severity',
      value: severity,
      change: setSeverity,
      options: SEVERITIES.map((x) => [x, x]),
    },
    {
      label: 'Namespace',
      value: namespace,
      change: setNamespace,
      options: namespaces.map((x) => [x, x || 'root']),
    },
    {
      label: 'Category',
      value: category,
      change: setCategory,
      options: [...CHECK_GROUPS, 'Legacy custom'].map((x) => [x, x]),
    },
  ];
  return (
    <section className="space-y-4" aria-label="Audit findings">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-48 flex-1 text-sm">
          Search
          <input
            className="mt-1 block w-full rounded border border-slate-200 bg-white p-2"
            placeholder="Check, object path or namespace"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              reset();
            }}
          />
        </label>
        <label className="w-36 shrink-0 text-sm">
          Group by
          <select
            className="mt-1 block w-full rounded border border-slate-200 bg-white p-2"
            value={grouping}
            onChange={(event) => {
              setGrouping(event.target.value as FindingGrouping);
              reset();
            }}
          >
            <option value="check">Check</option>
            <option value="object">Object</option>
            <option value="none">No grouping</option>
          </select>
        </label>
        {filters.map((filter) => (
          <label key={filter.label} className="w-36 shrink-0 text-sm">
            {filter.label}
            <select
              className="mt-1 block w-full rounded border border-slate-200 bg-white p-2"
              value={filter.value}
              onChange={(event) => {
                filter.change(event.target.value);
                reset();
              }}
            >
              <option value="all">All</option>
              {filter.options.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {detail.snapshot?.controls && (
        <p className="text-xs text-gray-500">
          Exception status was evaluated on {detail.snapshot.controls.appliedOn}
          . Reanalyze to evaluate current expiry; historical results are
          unchanged.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p>
          {matched.length.toLocaleString()} of{' '}
          {detail.findings.length.toLocaleString()} findings
          {grouping !== 'none' ? ` · ${groups.length} groups` : ''}
        </p>
        <AuditPageSize
          size={size}
          onChange={(value) => {
            setSize(value);
            reset();
          }}
        />
      </div>
      {!matched.length && (
        <p className="rounded border border-slate-200 bg-white p-4 text-sm text-gray-500">
          No findings match these filters. Review collection and analysis gaps
          before drawing conclusions.
        </p>
      )}
      <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {groups.slice((page - 1) * size, page * size).map((group) => (
          <div key={group.key}>
            <button
              className="flex w-full items-center gap-3 bg-white p-4 text-left hover:bg-slate-50 focus-visible:outline-blue-600"
              aria-expanded={expanded === group.key}
              onClick={() =>
                setExpanded(expanded === group.key ? null : group.key)
              }
            >
              <AuditDisclosureIcon level="group" />
              <span
                className={`w-16 shrink-0 rounded px-2 py-1 text-center text-xs ${['critical', 'high'].includes(group.severity) ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}
              >
                {group.severity}
              </span>
              <span className="min-w-0 flex-1 break-words text-sm font-medium">
                {group.title}
                <span className="mt-1 block text-xs font-normal text-gray-500">
                  {grouping === 'check' ? group.findings[0].ruleId : ''}
                </span>
              </span>
              <span className="text-sm">{group.findings.length}</span>
            </button>
            {expanded === group.key && (
              <FindingRows
                key={`${group.key}:${query}:${severity}:${namespace}:${category}:${status}:${size}`}
                findings={group.findings}
                size={size}
                controls={controls}
                statusOf={statusOf}
                detail={detail}
                usages={usages}
              />
            )}
          </div>
        ))}
      </div>
      <Pager
        page={page}
        total={groups.length}
        size={size}
        onChange={(next) => {
          setPage(next);
          setExpanded(null);
        }}
      />
    </section>
  );
}
