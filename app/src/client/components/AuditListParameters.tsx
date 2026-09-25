import { useId, useState } from 'react';
import type { CheckGroup } from '../../shared/auditCheckGroups';

type Change = { path: string[]; value: unknown };
type Props = {
  group: CheckGroup;
  detector: string;
  privileged: boolean;
  configuration: Record<string, unknown>;
  disabled: boolean;
  onChange: (changes: Change[]) => void;
};

function StringList({
  label,
  placeholder,
  hint,
  values,
  disabled,
  onChange,
}: {
  label: string;
  placeholder: string;
  hint: string;
  values: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}) {
  // Keep blank lines while typing; only normalized entries enter configuration.
  const [text, setText] = useState(values.join('\n'));
  const hintId = useId();
  return (
    <label className="block text-sm">
      {label}
      <textarea
        rows={3}
        placeholder={placeholder}
        aria-describedby={hintId}
        className="mt-1 block w-full rounded border p-2 font-mono text-xs placeholder:text-slate-400"
        disabled={disabled}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange([
            ...new Set(
              event.target.value
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          ]);
        }}
      />
      <span id={hintId} className="mt-1 block text-xs text-slate-500">
        {hint}
      </span>
    </label>
  );
}

export default function AuditListParameters({
  group,
  detector,
  privileged,
  configuration,
  disabled,
  onChange,
}: Props) {
  const [mount, setMount] = useState('');
  const [error, setError] = useState('');
  const section = (name: string) =>
    (configuration[name] ?? {}) as Record<string, unknown>;
  const lists =
    detector === 'jwt_broad_glob'
      ? [
          {
            section: 'jwt',
            key: 'broad_globs',
            label: 'Claim values considered broad',
            placeholder: '*\nteam-*',
            hint: 'One literal claim pattern per line. Compared exactly with role claim values; this list is not evaluated as regex.',
            fallback: ['*'],
          },
          {
            section: 'jwt',
            key: 'review_only_glob_claims',
            label:
              'Claims requiring review only when another claim restricts access',
            placeholder: 'ref_protected',
            hint: 'Exact claim names, one per line. No wildcard or regex matching.',
            fallback: ['ref_protected'],
          },
        ]
      : detector === 'kubernetes_wildcard_name'
        ? [
            {
              section: 'kubernetes',
              key: 'allowed_wildcard_namespaces',
              label:
                'Kubernetes namespaces allowed to use wildcard service accounts',
              placeholder: 'sandbox\nci',
              hint: 'Exact Kubernetes namespace names, one per line. No wildcard or regex matching.',
              fallback: [],
            },
          ]
        : [];
  const required = (section('jwt').required_bound_claims_by_mount ??
    {}) as Record<string, string[]>;
  return (
    <>
      {(!!lists.length || detector === 'jwt_bound_claims') && (
        <section className="border-t border-slate-200 pt-5">
          <h4 className="text-sm font-medium">{group} parameters</h4>
          <p className="mt-2 text-xs text-gray-500">
            One value per line. These settings apply to enabled detectors in
            this category.
          </p>
          <div className="mt-3 space-y-3">
            {lists.map((item) => (
              <StringList
                key={item.key}
                label={item.label}
                placeholder={item.placeholder}
                hint={item.hint}
                values={
                  (section(item.section)[item.key] ?? item.fallback) as string[]
                }
                disabled={disabled}
                onChange={(values) =>
                  onChange([{ path: [item.section, item.key], value: values }])
                }
              />
            ))}
          </div>
          {detector === 'jwt_bound_claims' && (
            <div className="mt-5 space-y-3">
              <h3 className="text-sm font-medium">
                Required bound claims by auth mount
              </h3>
              <p className="text-xs text-gray-500">
                Use the exact mount name such as oidc, without the auth/ prefix
                or trailing slash. Each entry lists claim names that roles must
                bind.
              </p>
              {Object.entries(required).map(([name, values]) => (
                <div key={name} className="rounded border p-3">
                  <StringList
                    label={`Required claims: ${name}`}
                    placeholder={'project_id\nnamespace_id'}
                    hint="Exact claim names that roles must bind, one per line."
                    values={values}
                    disabled={disabled}
                    onChange={(claims) =>
                      onChange([
                        {
                          path: ['jwt', 'required_bound_claims_by_mount'],
                          value: { ...required, [name]: claims },
                        },
                      ])
                    }
                  />
                  <button
                    type="button"
                    className="mt-2 text-sm text-red-700"
                    disabled={disabled}
                    onClick={() => {
                      const next = { ...required };
                      delete next[name];
                      onChange([
                        {
                          path: ['jwt', 'required_bound_claims_by_mount'],
                          value: next,
                        },
                      ]);
                    }}
                  >
                    Remove mount {name}
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">
                  Auth mount
                  <input
                    className="mt-1 block rounded border p-2"
                    placeholder="oidc"
                    value={mount}
                    disabled={disabled}
                    onChange={(event) => {
                      setMount(event.target.value);
                      setError('');
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="rounded border px-3 py-2 text-sm"
                  disabled={disabled}
                  onClick={() => {
                    const name = mount
                      .trim()
                      .replace(/^\/+|\/+$/g, '')
                      .replace(/^auth\//, '');
                    if (!name) {
                      setError('Enter an exact auth mount name.');
                      return;
                    }
                    if (Object.prototype.hasOwnProperty.call(required, name)) {
                      setError('This mount already has an entry.');
                      return;
                    }
                    onChange([
                      {
                        path: ['jwt', 'required_bound_claims_by_mount'],
                        value: { ...required, [name]: [] },
                      },
                    ]);
                    setMount('');
                    setError('');
                  }}
                >
                  Add mount
                </button>
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>
          )}
        </section>
      )}
      {privileged && (
        <section className="border-t border-slate-200 pt-5">
          <h4 className="text-sm font-medium">Privileged policy selectors</h4>
          <p className="mt-2 text-xs text-gray-500">
            Shared by assignment and authentication checks. These identify
            privileged policies; they do not exclude policies from analysis.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <StringList
              label="Exact policy names"
              placeholder={'root\nvault-admins'}
              hint="Exact names, one per line. No wildcard or regex matching."
              values={
                (section('privileged_policies').exact ?? [
                  'root',
                  'vault-admins',
                ]) as string[]
              }
              disabled={disabled}
              onChange={(values) =>
                onChange([
                  { path: ['privileged_policies', 'exact'], value: values },
                ])
              }
            />
            <StringList
              label="Policy name patterns"
              placeholder={'team-*-admin\nplatform-?'}
              hint="Glob patterns, one per line: * matches any sequence, ? one character, [abc] a character set. Not regex. Empty means no additional patterns."
              values={
                (section('privileged_policies').patterns ?? []) as string[]
              }
              disabled={disabled}
              onChange={(values) =>
                onChange([
                  { path: ['privileged_policies', 'patterns'], value: values },
                ])
              }
            />
          </div>
        </section>
      )}
    </>
  );
}
