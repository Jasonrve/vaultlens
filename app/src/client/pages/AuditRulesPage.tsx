import { useAuditDraft } from '../components/AuditDraftContext';
import AuditPagination from '../components/AuditPagination';
import {
  checkExample,
  checkObjectTypes,
  ttlDetectors,
  privilegedDetectors,
} from '../components/auditCheckPresentation';
import AuditListParameters from '../components/AuditListParameters';
import { useState } from 'react';
import { parseDocument } from 'yaml';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuditRules, saveAuditRules } from '../lib/api';
import { SEVERITIES, type RuleView } from '../../shared/auditRules';
import { CHECK_GROUPS, checkGroup } from '../../shared/auditCheckGroups';

const parameters: {
  detector: string;
  section: string;
  key: string;
  label: string;
  fallback: string | number | boolean;
}[] = [
  {
    detector: 'approle_secret_id_ttl',
    section: 'approle',
    key: 'secret_id_ttl_warning',
    label: 'SecretID TTL warning',
    fallback: '24h',
  },
  {
    detector: 'approle_secret_id_uses',
    section: 'approle',
    key: 'secret_id_num_uses_warning',
    label: 'SecretID use-count warning',
    fallback: 100,
  },
  {
    detector: 'approle_cidr_review',
    section: 'approle',
    key: 'require_cidr_for_privileged_roles',
    label: 'Require CIDR restrictions for privileged roles',
    fallback: true,
  },
];
const ttlParameters = [
  ['token_ttl_warning', 'Token TTL warning', '8h'],
  ['token_ttl_high', 'Token TTL high-risk threshold', '24h'],
  ['token_max_ttl_warning', 'Token maximum TTL warning', '24h'],
  ['token_max_ttl_high', 'Token maximum TTL high-risk threshold', '72h'],
] as const;

export default function AuditRulesPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['audit-rules'], queryFn: getAuditRules });
  const {
    draft,
    setDraft,
    group,
    setGroup,
    selected,
    setSelected,
    saving,
    setSaving,
    editorVersion,
    discard,
  } = useAuditDraft();
  const [message, setMessage] = useState('');
  const [size, setSize] = useState(10);
  const [sort, setSort] = useState<{
    key: 'Check' | 'Severity' | 'On';
    descending: boolean;
  } | null>(null);
  const save = useMutation({
    mutationFn: saveAuditRules,
    onMutate: () => setSaving(true),
    onSettled: () => setSaving(false),
    onSuccess: (data) => {
      client.setQueryData(['audit-rules'], data);
      setDraft(null);
      setMessage(
        `Settings revision ${data.settings.revision} saved. Existing runs are unchanged.`,
      );
    },
  });
  const settings = draft ?? query.data?.settings;
  const document = settings ? parseDocument(settings.configYaml) : null;
  const value = (path: string[], fallback: unknown) =>
    document?.getIn(path) ?? fallback;
  const rules =
    query.data?.catalog.filter((rule) => rule.source === 'builtin') ?? [];
  const active = (rule: RuleView) =>
    Boolean(value(['rules', rule.id, 'enabled'], rule.active));
  const hasSeverityOverride = (rule: RuleView) =>
    document?.hasIn(['rules', rule.id, 'severity']) ?? false;
  const severity = (rule: RuleView) =>
    String(value(['rules', rule.id, 'severity'], rule.severity));
  const members =
    group === 'All'
      ? rules
      : rules.filter((rule) => checkGroup(rule) === group);
  function sorted(items: RuleView[], order: typeof sort) {
    if (!order) return items;
    return [...items].sort((a, b) => {
      const result =
        order.key === 'Check'
          ? a.title.localeCompare(b.title, 'en', { sensitivity: 'base' })
          : order.key === 'On'
            ? Number(active(a)) - Number(active(b))
            : SEVERITIES.indexOf(severity(b) as (typeof SEVERITIES)[number]) -
              SEVERITIES.indexOf(severity(a) as (typeof SEVERITIES)[number]);
      return (
        (order.descending ? -result : result) ||
        a.id.localeCompare(b.id, 'en', { numeric: true })
      );
    });
  }
  const inGroup = sorted(members, sort);
  function changeSort(key: 'Check' | 'Severity' | 'On') {
    const next = {
      key,
      descending: sort?.key === key ? !sort.descending : key !== 'Check',
    };
    setSort(next);
    setSelected(sorted(members, next)[0]?.id ?? '');
  }
  const chosen = inGroup.find((rule) => rule.id === selected) ?? inGroup[0];
  const chosenIndex = Math.max(
    0,
    inGroup.findIndex((rule) => rule.id === chosen?.id),
  );
  const page = Math.floor(chosenIndex / size) + 1;
  const visible = inGroup.slice((page - 1) * size, page * size);
  const example = chosen ? checkExample(chosen) : null;
  const isTTL = !!chosen && ttlDetectors.has(chosen.detector);
  const privileged = !!chosen && privilegedDetectors.has(chosen.detector);
  const chosenParameters = parameters.filter(
    (p) => p.detector === chosen?.detector,
  );
  if (chosen?.id === 'PKI-008') chosenParameters.push({
    detector: 'domain_configuration', section: 'thresholds', key: 'certificate_ttl_minimum',
    label: 'Minimum certificate lifetime (seconds, or duration such as 12h or 1d)', fallback: '24h',
  });
  const listParameters =
    !!chosen &&
    ['jwt_broad_glob', 'jwt_bound_claims', 'kubernetes_wildcard_name'].includes(
      chosen.detector,
    );
  function update(changes: { path: string[]; value: unknown }[]) {
    if (!settings || !document || saving) return;
    for (const change of changes) {
      if (change.value === undefined) document.deleteIn(change.path);
      else document.setIn(change.path, change.value);
    }
    setDraft({ ...settings, configYaml: document.toString() });
    setMessage('');
  }
  const legacy =
    query.data?.catalog.filter((rule) => rule.source === 'custom') ?? [];
  function persist() {
    if (!settings || !document) return;
    // Keep historical definitions readable, but the managed UI only runs built-in checks.
    for (const rule of legacy)
      document.setIn(['rules', rule.id, 'enabled'], false);
    save.mutate({ ...settings, configYaml: document.toString() });
  }
  const error = save.error as {
    response?: { data?: { error?: string } };
    message?: string;
  } | null;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Checks</h2>
          <p className="mt-1 text-sm text-gray-500">
            Built-in checks for the current Vault. Changes apply to new
            analyses.
          </p>
        </div>
        <div className="flex gap-2">
          {draft && (
            <button
              disabled={saving}
              className="rounded border px-3 py-2 text-sm disabled:opacity-50"
              onClick={() => {
                discard();
                save.reset();
                setMessage('Unsaved changes discarded.');
              }}
            >
              Discard changes
            </button>
          )}
          <button
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={
              !settings ||
              saving ||
              (!draft && !legacy.some((rule) => rule.active))
            }
            onClick={persist}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
      {query.isPending && <p>Loading checks…</p>}
      {query.error && (
        <p role="alert">
          Could not load check settings. Administrator access is required.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error.response?.data?.error ?? error.message}. Your unsaved changes
          are retained.
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-green-800">
          {message}
        </p>
      )}
      {settings && (
        <>
          <p className="text-sm text-gray-500">
            Revision {settings.revision} {draft ? '· Unsaved changes' : ''} ·{' '}
            {rules.filter(active).length} of {rules.length} built-in checks
            enabled
          </p>
          {draft && (
            <p className="text-xs text-gray-500">
              Your draft is retained when switching audit tabs. Save before
              leaving Security Audit or reloading the page.
            </p>
          )}
          {draft &&
            query.data &&
            draft.revision !== query.data.settings.revision && (
              <p role="alert" className="text-sm text-amber-800">
                Saved settings changed since this draft began. Your draft is
                retained; discard it to load the current revision. Saving cannot
                overwrite a newer revision.
              </p>
            )}
          {!!legacy.length && (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              This workspace has {legacy.length} legacy custom definitions.
              Saving these settings disables them for future analyses;
              historical runs retain their original definitions.
            </p>
          )}
          <div className="flex flex-wrap gap-2" aria-label="Check categories">
            {(['All', ...CHECK_GROUPS] as const).map((category) => {
              const members =
                category === 'All'
                  ? rules
                  : rules.filter((rule) => checkGroup(rule) === category);
              return (
                <button
                  key={category}
                  aria-pressed={category === group}
                  onClick={() => {
                    setGroup(category);
                    setSelected('');
                  }}
                  className={`rounded border px-3 py-2 text-sm ${category === group ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200'}`}
                >
                  {category}{' '}
                  <span className="ml-2 text-xs">
                    {members.filter(active).length}/{members.length}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">
            Categories group checks by topic. Each check shows its resource
            type.
          </p>
          {!inGroup.length ? (
            <p className="rounded border p-4 text-sm text-gray-500">
              No dedicated built-in checks in this category yet. Collection of
              these objects does not imply they have passed a check.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                <h3 className="text-sm font-medium">
                  {group} / {inGroup.length} checks
                </h3>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={inGroup.every(active)}
                    ref={(node) => {
                      if (node)
                        node.indeterminate =
                          inGroup.some(active) && !inGroup.every(active);
                    }}
                    disabled={saving}
                    onChange={(event) =>
                      update(
                        inGroup.map((rule) => ({
                          path: ['rules', rule.id, 'enabled'],
                          value: event.target.checked,
                        })),
                      )
                    }
                  />
                  {group === 'All'
                    ? `Enable all ${rules.length} checks`
                    : `Enable all ${group} checks`}
                </label>
              </div>
              <div className="grid items-start gap-5 lg:grid-cols-[minmax(220px,1fr)_minmax(280px,1.2fr)]">
                <div className="min-w-0" aria-label="Check list">
                  <div className="grid grid-cols-[40px_minmax(0,1fr)_80px] gap-2 border-b border-slate-200 px-3 py-2 text-xs text-slate-500">
                    {(['On', 'Check', 'Severity'] as const).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => changeSort(key)}
                        aria-label={`Sort by ${key}${sort?.key === key ? (sort.descending ? ', descending' : ', ascending') : ''}`}
                        className={`flex items-center gap-1 text-left hover:text-blue-700 ${sort?.key === key ? 'text-blue-700' : ''}`}
                      >
                        {key}
                        <span aria-hidden="true">
                          {sort?.key === key
                            ? sort.descending
                              ? '↓'
                              : '↑'
                            : '↕'}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="divide-y divide-slate-200">
                    {visible.map((rule) => (
                      <div
                        key={rule.id}
                        className={`grid grid-cols-[40px_minmax(0,1fr)] items-center gap-2 px-3 py-3 ${rule.id === chosen?.id ? 'bg-blue-50 shadow-[inset_2px_0_0_#2563eb]' : 'hover:bg-slate-50'}`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Enable ${rule.id}`}
                          checked={active(rule)}
                          disabled={saving}
                          onChange={(event) =>
                            update([
                              {
                                path: ['rules', rule.id, 'enabled'],
                                value: event.target.checked,
                              },
                            ])
                          }
                        />
                        <button
                          type="button"
                          onClick={() => setSelected(rule.id)}
                          aria-pressed={rule.id === chosen?.id}
                          aria-controls="check-configuration"
                          className="grid min-w-0 grid-cols-[minmax(0,1fr)_80px] items-center gap-2 text-left"
                        >
                          <span className="min-w-0">
                            <span className="text-xs text-slate-500">
                              {rule.id} / {checkObjectTypes(rule)}
                            </span>
                            <span className="mt-1 block text-sm font-medium">
                              {rule.title}
                            </span>
                          </span>
                          <span className="text-xs capitalize text-slate-500">
                            {severity(rule)}
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                  <AuditPagination
                    page={page}
                    size={size}
                    total={inGroup.length}
                    onChange={(next) =>
                      setSelected(inGroup[(next - 1) * size]?.id ?? '')
                    }
                    onSizeChange={setSize}
                  />
                </div>
                {chosen && (
                  <section
                    id="check-configuration"
                    aria-label="Selected check configuration"
                    className="min-h-[900px] min-w-0 space-y-5 rounded-lg border border-slate-200 bg-white p-5"
                  >
                    <div>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <span className="text-xs text-slate-500">
                          {chosen.id} / {checkObjectTypes(chosen)} ·{' '}
                          {chosen.status}
                        </span>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <label htmlFor="check-severity">Severity</label>
                          <select
                            id="check-severity"
                            aria-label="Check severity"
                            aria-describedby="check-severity-help"
                            disabled={saving}
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                            value={severity(chosen)}
                            onChange={(event) =>
                              update([
                                {
                                  path: ['rules', chosen.id, 'severity'],
                                  value: event.target.value,
                                },
                              ])
                            }
                          >
                            {SEVERITIES.map((level) => (
                              <option key={level} value={level}>
                                {level}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-40"
                            disabled={saving || !hasSeverityOverride(chosen)}
                            onClick={() =>
                              update([
                                {
                                  path: ['rules', chosen.id, 'severity'],
                                  value: undefined,
                                },
                              ])
                            }
                          >
                            Reset to default
                          </button>
                        </div>
                      </div>
                      <h3 className="text-lg font-semibold">{chosen.title}</h3>
                      <p className="mt-2 text-xs text-slate-500">
                        {active(chosen)
                          ? 'Enabled · included in new analyses'
                          : 'Disabled · skipped in new analyses'}
                      </p>
                      <p
                        id="check-severity-help"
                        className="mt-2 text-xs text-slate-500"
                      >
                        {hasSeverityOverride(chosen)
                          ? `Manual override: ${severity(chosen)}. Default: ${chosen.severity}. Reset restores the check's default severity logic.`
                          : isTTL
                            ? 'Default: medium. Findings become high above a high threshold; actual severity is determined during analysis.'
                            : `Default: ${chosen.severity}. Findings may use a different severity when the detector evaluates the collected data.`}
                      </p>
                    </div>
                    <p className="text-sm text-slate-600">
                      {chosen.description}
                    </p>
                    {example && (
                      <div className="rounded-md bg-slate-50 p-3">
                        <h4 className="text-xs font-medium text-slate-500">
                          {example.label}
                        </h4>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-700">
                          <code>{example.source}</code>
                        </pre>
                        {isTTL && (
                          <p className="mt-2 text-xs text-slate-500">
                            With default limits, this example produces a medium
                            finding. Current thresholds and severity overrides
                            determine the actual result.
                          </p>
                        )}
                      </div>
                    )}
                    <div className="space-y-5 border-t border-slate-200 pt-5">
                      <h4 className="text-sm font-medium">Check parameters</h4>
                      {!isTTL &&
                        !privileged &&
                        !chosenParameters.length &&
                        !listParameters && (
                          <p className="text-sm text-slate-500">
                            This check uses built-in detection conditions and
                            has no configurable analysis parameters.
                          </p>
                        )}
                      {chosenParameters.map((p) => (
                        <label key={p.key} className="block text-sm">
                          {p.label}
                          {typeof p.fallback === 'boolean' ? (
                            <input
                              type="checkbox"
                              className="ml-2"
                              disabled={saving}
                              checked={Boolean(
                                value([p.section, p.key], p.fallback),
                              )}
                              onChange={(event) =>
                                update([
                                  {
                                    path: [p.section, p.key],
                                    value: event.target.checked,
                                  },
                                ])
                              }
                            />
                          ) : (
                            <input
                              className="mt-2 block w-full rounded border border-slate-200 p-2 placeholder:text-slate-400"
                              disabled={saving}
                              type={
                                typeof p.fallback === 'number'
                                  ? 'number'
                                  : 'text'
                              }
                              min={0}
                              placeholder={String(p.fallback)}
                              value={String(
                                value([p.section, p.key], p.fallback),
                              )}
                              onChange={(event) =>
                                update([
                                  {
                                    path: [p.section, p.key],
                                    value:
                                      typeof p.fallback === 'number'
                                        ? Number(event.target.value)
                                        : event.target.value,
                                  },
                                ])
                              }
                            />
                          )}
                          <span className="mt-1 block text-xs text-slate-500">
                            Default: {String(p.fallback)}
                          </span>
                        </label>
                      ))}
                      {isTTL && (
                        <div>
                          <h4 className="text-sm font-medium">
                            Token lifetime / Shared thresholds
                          </h4>
                          <p className="mt-2 text-xs text-slate-500">
                            Shared by AppRole, Kubernetes and JWT/OIDC token
                            lifetime checks. These are analysis limits; they do
                            not change Vault token settings. Durations accept
                            seconds or values such as 8h and 1d.
                          </p>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            {ttlParameters.map(([key, label, fallback]) => (
                              <label key={key} className="text-sm">
                                {label}
                                <input
                                  className="mt-2 block w-full rounded border border-slate-200 p-2 placeholder:text-slate-400"
                                  disabled={saving}
                                  placeholder={fallback}
                                  value={String(
                                    value(['thresholds', key], fallback),
                                  )}
                                  onChange={(event) =>
                                    update([
                                      {
                                        path: ['thresholds', key],
                                        value: event.target.value,
                                      },
                                    ])
                                  }
                                />
                                <span className="mt-1 block text-xs text-slate-500">
                                  Default: {fallback}
                                </span>
                              </label>
                            ))}
                          </div>
                          <p className="mt-3 text-xs text-slate-500">
                            Triggers when either TTL is strictly greater than
                            its threshold. Equal values do not trigger that
                            threshold.
                          </p>
                        </div>
                      )}
                      <AuditListParameters
                        key={`${settings.revision}:${chosen.id}:${editorVersion}`}
                        group={checkGroup(chosen)}
                        detector={chosen.detector}
                        privileged={privileged}
                        configuration={document?.toJS() ?? {}}
                        disabled={saving}
                        onChange={update}
                      />
                    </div>
                    <div className="border-t border-slate-200 pt-5">
                      <h4 className="text-sm font-medium">Recommendation</h4>
                      <p className="mt-2 text-sm text-slate-600">
                        {chosen.remediation}
                      </p>
                    </div>
                    {!chosen.supported && (
                      <p className="text-sm text-amber-800">
                        This detector is unavailable. Enabling it produces a
                        coverage gap.
                      </p>
                    )}
                  </section>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
