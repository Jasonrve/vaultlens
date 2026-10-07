import AuditPagination from './AuditPagination';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAuditRules,
  toggleAuditException,
  getAuditObjectExceptions,
  removeAuditObjectException,
  saveAuditObjectException,
  type AuditExceptionInput,
} from '../lib/api';
import type { AuditException } from '../../shared/securityAudit';
const empty: AuditExceptionInput = {
  name: '',
  enabled: false,
  object_type: 'policy',
  match: 'exact',
  rule_id: '',
  namespace: '',
  object_path: '',
  owner: '',
  reason: '',
  expires: '',
};
function errorText(error: unknown) {
  const e = error as {
    response?: { data?: { error?: string } };
    message?: string;
  } | null;
  return e?.response?.data?.error ?? e?.message;
}
export default function AuditObjectExceptions() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['audit-object-exceptions'],
    queryFn: getAuditObjectExceptions,
  });
  const rules = useQuery({ queryKey: ['audit-rules'], queryFn: getAuditRules });
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('All'),
    [requested, setPage] = useState(1);
  const [editor, setEditor] = useState<{
    id?: string;
    value: AuditExceptionInput;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const refresh = () =>
    client.invalidateQueries({ queryKey: ['audit-object-exceptions'] });
  const remove = useMutation({
    mutationFn: removeAuditObjectException,
    onSuccess: () => {
      refresh();
      setNotice(
        'Exception removed from future analyses. Historical results are unchanged.',
      );
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      toggleAuditException(id, enabled),
    onSuccess: () => {
      refresh();
      setNotice('Exception state saved. Applies to new analyses only.');
    },
  });
  const save = useMutation({
    mutationFn: ({ value, id }: { value: AuditExceptionInput; id?: string }) =>
      saveAuditObjectException(value, id),
    onSuccess: () => {
      refresh();
      setEditor(null);
      setNotice(
        'Exception saved for future analyses. Reanalyze a snapshot to apply it.',
      );
    },
  });
  const now = new Date(),
    today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const matches =
    query.data?.filter(
      (entry) =>
        (status === 'All' ||
          (entry.enabled === false
            ? 'Disabled'
            : entry.expires !== 'never' && entry.expires < today
              ? 'Expired'
              : 'Enabled') === status) &&
        [
          entry.name ?? '',
          entry.object_type ?? '',
          entry.rule_id,
          entry.namespace,
          entry.object_path,
          entry.owner,
          entry.reason,
        ].some((value) => value.toLowerCase().includes(search.toLowerCase())),
    ) ?? [];
  const [size, setSize] = useState(10);
  const page = Math.min(
    requested,
    Math.max(1, Math.ceil(matches.length / size)),
  );
  function edit(entry?: AuditException) {
    save.reset();
    setNotice('');
    setEditor({
      id: entry?.id,
      value: entry
        ? {
            name: entry.name ?? '',
            enabled: entry.enabled !== false,
            object_type: entry.object_type ?? 'any',
            match: entry.match ?? 'exact',
            rule_id: entry.rule_id,
            namespace: entry.namespace,
            object_path: entry.object_path,
            owner: entry.owner,
            reason: entry.reason,
            expires: entry.expires,
          }
        : { ...empty },
    });
  }
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Exceptions</h2>
        <button
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={!!editor}
          onClick={() => edit()}
        >
          Add exception
        </button>
      </div>
      <p className="text-sm text-gray-500">
        Enabled exceptions mark matching findings as excepted in new analyses.
        Built-in presets are off by default. Saved runs remain unchanged.
      </p>
      {notice && (
        <p role="status" className="text-sm text-blue-700">
          {notice}
        </p>
      )}
      {editor && (
        <form
          className="space-y-3 rounded border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(editor);
          }}
        >
          <h3 className="font-medium">
            {editor.id ? 'Edit exception' : 'Add exception'}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Name
              <input
                className="mt-1 block w-full rounded border border-slate-200 p-2"
                required
                maxLength={200}
                value={editor.value.name ?? ''}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    value: { ...editor.value, name: e.target.value },
                  })
                }
              />
            </label>
            <label className="text-sm">
              Object type
              <select
                className="mt-1 block w-full rounded border border-slate-200 p-2"
                value={editor.value.object_type ?? 'any'}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    value: {
                      ...editor.value,
                      object_type: e.target
                        .value as AuditException['object_type'],
                      enabled: false,
                    },
                  })
                }
              >
                {Object.entries({
                  policy: 'Policy',
                  token: 'Token (not collected)',
                  'auth-role': 'Auth role',
                  entity: 'Identity entity',
                  group: 'Identity group',
                  any: 'Any object',
                }).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editor.value.enabled !== false}
              disabled={editor.value.object_type === 'token'}
              onChange={(e) =>
                setEditor({
                  ...editor,
                  value: { ...editor.value, enabled: e.target.checked },
                })
              }
            />
            Enable exception
          </label>
          {editor.value.object_type === 'token' && (
            <p className="text-xs text-amber-800">
              Individual token collection is not supported. This preset remains
              disabled; do not enter a token value.
            </p>
          )}
          <label className="block text-sm">
            Check
            <select
              required
              disabled={save.isPending || rules.isPending || !!rules.error}
              className="mt-1 block w-full rounded border p-2 placeholder:text-slate-400"
              value={editor.value.rule_id}
              onChange={(event) =>
                setEditor({
                  ...editor,
                  value: { ...editor.value, rule_id: event.target.value },
                })
              }
            >
              <option value="">Select a built-in check</option>
              {editor.value.object_type &&
                editor.value.object_type !== 'any' && (
                  <option value="*">All checks for this object type</option>
                )}
              {rules.data?.catalog
                .filter((rule) => rule.source === 'builtin')
                .map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.id} · {rule.title}
                  </option>
                ))}
            </select>
          </label>
          {rules.error && (
            <p role="alert" className="text-sm text-red-700">
              Could not load checks: {errorText(rules.error)}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {(['namespace', 'object_path', 'owner', 'expires'] as const).map(
              (key) => (
                <label key={key} className="text-sm">
                  {
                    {
                      namespace: 'Vault namespace (empty = root)',
                      object_path: 'Object API path',
                      owner: 'Owner',
                      expires: 'Expiry date',
                    }[key]
                  }
                  <input
                    required={key !== 'namespace'}
                    disabled={save.isPending}
                    type="text"
                    maxLength={
                      key === 'owner' ? 200 : key === 'namespace' ? 1024 : 2048
                    }
                    placeholder={
                      key === 'object_path'
                        ? editor.value.match === 'glob'
                          ? 'sys/policies/acl/team-*'
                          : 'sys/policies/acl/default'
                        : key === 'expires'
                          ? 'YYYY-MM-DD or never'
                          : key === 'owner'
                            ? 'Platform team'
                            : 'Root namespace'
                    }
                    className="mt-1 block w-full rounded border p-2 placeholder:text-slate-400"
                    value={editor.value[key]}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        value: { ...editor.value, [key]: event.target.value },
                      })
                    }
                  />
                </label>
              ),
            )}
          </div>
          <label className="block text-sm">
            Path matching
            <select
              className="mt-1 block w-full rounded border border-slate-200 p-2"
              value={editor.value.match ?? 'exact'}
              onChange={(e) =>
                setEditor({
                  ...editor,
                  value: {
                    ...editor.value,
                    match: e.target.value as 'exact' | 'glob',
                  },
                })
              }
            >
              <option value="exact">Exact path</option>
              <option value="glob">Glob pattern</option>
            </select>
          </label>
          <p className="text-xs text-slate-500">
            Use the path shown in Findings. For an exact root namespace, leave
            Namespace empty; for glob matching use root. Policy exceptions do
            not exclude assignments on other objects. Glob matching supports *
            (any sequence), ? (one character), and [abc] (character set), not
            regex. Exact matching treats the path literally.
          </p>
          <label className="block text-sm">
            Reason
            <textarea
              required
              maxLength={2000}
              disabled={save.isPending}
              className="mt-1 block w-full rounded border p-2 placeholder:text-slate-400"
              placeholder="Why this exception is needed and how the risk is controlled"
              value={editor.value.reason}
              onChange={(event) =>
                setEditor({
                  ...editor,
                  value: { ...editor.value, reason: event.target.value },
                })
              }
            />
          </label>
          {save.error && (
            <p role="alert" className="text-sm text-red-700">
              {errorText(save.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => setEditor(null)}
              className="rounded border px-3 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={save.isPending || rules.isPending || !!rules.error}
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save exception'}
            </button>
          </div>
        </form>
      )}
      {query.isPending && <p>Loading exceptions…</p>}
      {(query.error || remove.error || toggle.error) && (
        <p role="alert" className="text-sm text-red-700">
          {errorText(query.error || remove.error || toggle.error)}
        </p>
      )}
      <div className="text-xs text-slate-500">
        {query.data?.length ?? 0} exceptions ·{' '}
        {query.data?.filter((e) => e.enabled !== false).length ?? 0} enabled
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex-1 text-sm">
          Search
          <input
            placeholder="Check, object, namespace, owner or reason"
            className="mt-1 block w-full rounded border p-2 placeholder:text-slate-400"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="text-sm">
          Status
          <select
            className="mt-1 block rounded border p-2"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            {['All', 'Enabled', 'Disabled', 'Expired'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              {[
                'Exception status',
                'Exception / type',
                'Target / namespace',
                'Checks',
                'Actions',
              ].map((label) => (
                <th key={label} className="p-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matches.slice((page - 1) * size, page * size).map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-slate-200 hover:bg-slate-50"
              >
                <td className="p-3 align-top">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`Enable exception for ${entry.name || entry.rule_id}`}
                      aria-describedby={`exception-effect-${entry.id}`}
                      checked={entry.enabled !== false}
                      disabled={
                        toggle.isPending ||
                        !!editor ||
                        entry.object_type === 'token'
                      }
                      onChange={(e) =>
                        toggle.mutate({
                          id: entry.id,
                          enabled: e.target.checked,
                        })
                      }
                      className="peer sr-only"
                    />
                    <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 after:absolute after:left-1 after:top-1 after:h-3 after:w-3 after:rounded-full after:bg-white peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-disabled:opacity-50" />
                    <span className="whitespace-nowrap">
                      {entry.enabled === false
                        ? 'Exception off'
                        : 'Exception on'}
                    </span>
                  </label>
                  <p
                    id={`exception-effect-${entry.id}`}
                    className="mt-2 max-w-48 text-xs text-slate-500"
                  >
                    {entry.object_type === 'token'
                      ? 'Target not collected. Exception unavailable.'
                      : entry.enabled === false
                        ? 'Target stays in audit scope. No findings are excepted by this rule.'
                        : entry.expires !== 'never' && entry.expires < today
                          ? 'Exception expired. Target stays in audit scope.'
                          : 'Selected checks still run. Matching findings are marked as excepted.'}
                  </p>
                </td>
                <td className="p-3 align-top">
                  <div className="font-medium">
                    {entry.name || entry.rule_id}
                  </div>
                  <div className="text-xs text-slate-500">
                    {entry.object_type ?? 'Any object'}
                  </div>
                  <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 text-xs text-slate-600">
                    {entry.builtin ? 'Built-in' : 'Custom'}
                  </span>
                </td>
                <td className="p-3 align-top">
                  <div className="max-w-xs break-all font-mono text-xs">
                    {entry.object_path}
                  </div>
                  <div className="text-xs text-slate-500">
                    {entry.namespace || 'root'} · {entry.match ?? 'glob'}
                  </div>
                  <div className="text-xs text-slate-500">
                    Expires: {entry.expires}
                  </div>
                  {entry.expires !== 'never' && entry.expires < today && (
                    <div className="text-xs text-amber-800">Expired</div>
                  )}
                </td>
                <td className="p-3 align-top">
                  {entry.rule_id === '*' ? 'All checks' : entry.rule_id}
                  {entry.object_type === 'token' && (
                    <p className="max-w-48 text-xs text-amber-800">
                      Individual tokens are not collected. Preset unavailable.
                    </p>
                  )}
                </td>
                <td className="p-3 align-top">
                  <div className="flex gap-2">
                    <button
                      className="rounded-md border border-slate-200 px-3 py-1.5"
                      disabled={!!editor}
                      onClick={() => edit(entry)}
                    >
                      Edit
                    </button>
                    {!entry.builtin && (
                      <button
                        className="rounded-md border border-slate-200 px-3 py-1.5"
                        disabled={remove.isPending || !!editor}
                        onClick={() => remove.mutate(entry.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!query.isPending && !query.error && !matches.length && (
        <p className="text-sm text-gray-500">No matching exceptions.</p>
      )}
      <AuditPagination
        page={page}
        total={matches.length}
        size={size}
        onChange={setPage}
        onSizeChange={setSize}
      />
    </section>
  );
}
