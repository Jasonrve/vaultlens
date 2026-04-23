import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import type { PolicyPath, SecretEngine, AuthMethod } from '../../types';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import Badge from '../common/Badge';
import SuggestionsCombobox from '../common/SuggestionsCombobox';
import PolicyTesterPanel from './PolicyTesterPanel';
import type { PolicyRule } from './PolicyTesterPanel';

const ALL_CAPABILITIES = ['create', 'read', 'update', 'delete', 'list', 'sudo', 'deny'] as const;
type Capability = (typeof ALL_CAPABILITIES)[number];

const CAP_COLORS: Record<Capability, string> = {
  create: 'bg-green-100 text-green-700 border-green-300',
  read: 'bg-blue-100 text-blue-700 border-blue-300',
  update: 'bg-amber-100 text-amber-700 border-amber-300',
  delete: 'bg-red-100 text-red-700 border-red-300',
  list: 'bg-purple-100 text-purple-700 border-purple-300',
  sudo: 'bg-orange-100 text-orange-700 border-orange-300',
  deny: 'bg-gray-200 text-gray-700 border-gray-400',
};

interface VisualRow {
  id: number;
  path: string;
  capabilities: Capability[];
}

function generateHCL(rows: VisualRow[]): string {
  return rows
    .filter((r) => r.path.trim())
    .map((r) => {
      const caps = r.capabilities.map((c) => `"${c}"`).join(', ');
      return `path "${r.path.trim()}" {\n  capabilities = [${caps}]\n}`;
    })
    .join('\n\n');
}

function parseToVisualRows(paths: PolicyPath[]): VisualRow[] {
  return paths.map((p, i) => ({
    id: i + 1,
    path: p.path,
    capabilities: p.capabilities.filter((c): c is Capability =>
      ALL_CAPABILITIES.includes(c as Capability)
    ),
  }));
}

// ── Client-side HCL parser ─────────────────────────────────
/** Parse HCL text into VisualRows without a server round-trip. */
function parseHCLClientSide(hcl: string): VisualRow[] {
  const rows: VisualRow[] = [];
  const pathRegex = /path\s+"([^"\\]*(?:\\.[^"\\]*)*)"\s*\{/g;
  let id = 1;
  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(hcl)) !== null) {
    const pathValue = match[1];
    const blockStart = pathRegex.lastIndex;
    let depth = 1;
    let pos = blockStart;
    while (pos < hcl.length && depth > 0) {
      if (hcl[pos] === '{') depth++;
      else if (hcl[pos] === '}') depth--;
      pos++;
    }
    const block = hcl.slice(blockStart, pos - 1);
    const capMatch = /capabilities\s*=\s*\[([^\]]*)\]/.exec(block);
    if (capMatch?.[1]) {
      const capabilities = capMatch[1]
        .split(',')
        .map((c) => c.trim().replace(/"/g, ''))
        .filter((c): c is Capability => ALL_CAPABILITIES.includes(c as Capability));
      rows.push({ id: id++, path: pathValue, capabilities });
    }
  }
  return rows;
}

// ── Path autocomplete suggestions ─────────────────────────
function buildPathSuggestions(engines: SecretEngine[], authMethods: AuthMethod[]): string[] {
  const suggestions: string[] = [
    // sys paths
    'sys/*', 'sys/mounts', 'sys/mounts/*', 'sys/mounts/+/tune',
    'sys/auth', 'sys/auth/*', 'sys/auth/+/tune',
    'sys/policies/acl', 'sys/policies/acl/*',
    'sys/policy/*',
    'sys/audit', 'sys/audit/*',
    'sys/health', 'sys/seal-status', 'sys/seal', 'sys/unseal',
    'sys/leader', 'sys/host-info', 'sys/replication/status',
    'sys/metrics', 'sys/internal/counters/*', 'sys/internal/ui/mounts',
    'sys/capabilities-self', 'sys/capabilities', 'sys/capabilities-accessor',
    'sys/storage/raft/snapshot', 'sys/storage/raft/configuration',
    'sys/wrapping/wrap', 'sys/wrapping/unwrap', 'sys/wrapping/lookup',
    'sys/leases/lookup', 'sys/leases/renew', 'sys/leases/revoke', 'sys/leases/revoke-prefix/*',
    'sys/renew/*', 'sys/revoke/*',
    // identity paths
    'identity/*',
    'identity/entity', 'identity/entity/*',
    'identity/entity/id', 'identity/entity/id/*',
    'identity/entity/name', 'identity/entity/name/*',
    'identity/entity-alias', 'identity/entity-alias/*',
    'identity/entity-alias/id/*',
    'identity/group', 'identity/group/*',
    'identity/group/id', 'identity/group/id/*',
    'identity/group/name', 'identity/group/name/*',
    'identity/group-alias', 'identity/group-alias/*',
    'identity/group-alias/id/*',
    'identity/oidc/*',
    // cubbyhole
    'cubbyhole/*', 'cubbyhole/+',
    // auth token
    'auth/token/create', 'auth/token/create/*', 'auth/token/lookup',
    'auth/token/lookup-self', 'auth/token/renew', 'auth/token/renew-self',
    'auth/token/revoke', 'auth/token/revoke-self', 'auth/token/roles/*',
  ];
  for (const engine of engines) {
    const mount = engine.path;
    const isKvV2 = engine.type === 'kv' && engine.options?.['version'] === '2';
    if (isKvV2) {
      suggestions.push(
        mount + '*',
        mount + '+',
        mount + '+/*',
        mount + 'data/*',
        mount + 'data/**',
        mount + 'data/+',
        mount + 'data/+/*',
        mount + 'data/+/**',
        mount + 'metadata',
        mount + 'metadata/*',
        mount + 'metadata/**',
        mount + 'metadata/+',
        mount + 'metadata/+/*',
        mount + 'delete/*',
        mount + 'delete/+',
        mount + 'delete/+/*',
        mount + 'undelete/*',
        mount + 'undelete/+/*',
        mount + 'destroy/*',
        mount + 'destroy/+/*',
        mount + 'config',
      );
    } else if (engine.type === 'kv') {
      suggestions.push(
        mount + '*', mount + '**', mount + '+', mount + '+/*',
        mount + 'config',
      );
    } else if (engine.type === 'pki') {
      suggestions.push(
        mount + '*',
        mount + 'issue/*', mount + 'issue/+',
        mount + 'cert/*', mount + 'cert/+',
        mount + 'roles/*', mount + 'roles/+',
        mount + 'config/*', mount + 'config/+',
        mount + 'sign/*', mount + 'sign-verbatim/*',
        mount + 'ca', mount + 'ca/pem', mount + 'ca_chain',
        mount + 'crl', mount + 'crl/rotate',
        mount + 'revoke', mount + 'tidy',
      );
    } else if (engine.type === 'transit') {
      suggestions.push(
        mount + '*',
        mount + 'encrypt/*', mount + 'decrypt/*',
        mount + 'keys/*', mount + 'keys/+',
        mount + 'sign/*', mount + 'verify/*',
        mount + 'hmac/*', mount + 'hash/*',
        mount + 'random/*', mount + 'rewrap/*',
        mount + 'backup/*', mount + 'restore/*',
        mount + 'export/+/*',
      );
    } else if (engine.type === 'database') {
      suggestions.push(
        mount + '*',
        mount + 'config/*', mount + 'config/+',
        mount + 'roles/*', mount + 'roles/+',
        mount + 'static-roles/*', mount + 'static-roles/+',
        mount + 'creds/*', mount + 'creds/+',
        mount + 'static-creds/*', mount + 'static-creds/+',
        mount + 'rotate-root/*', mount + 'rotate/*',
      );
    } else if (engine.type === 'aws') {
      suggestions.push(
        mount + '*',
        mount + 'config/root', mount + 'config/lease',
        mount + 'roles/*', mount + 'roles/+',
        mount + 'creds/*', mount + 'creds/+',
        mount + 'sts/*', mount + 'sts/+',
      );
    } else if (engine.type === 'ssh') {
      suggestions.push(
        mount + '*',
        mount + 'roles/*', mount + 'roles/+',
        mount + 'sign/*', mount + 'sign/+',
        mount + 'verify', mount + 'config/ca',
      );
    } else {
      suggestions.push(mount + '*', mount + '**');
    }
  }
  for (const method of authMethods) {
    const mount = 'auth/' + method.path;
    suggestions.push(
      mount + '*',
      mount + 'config',
      mount + 'role/*', mount + 'role/+',
      mount + 'roles/*', mount + 'roles/+',
      mount + 'login',
      mount + 'login/*',
      mount + 'users/*', mount + 'users/+',
      mount + 'groups/*', mount + 'groups/+',
      mount + 'certs/*', mount + 'certs/+',
    );
  }
  return [...new Set(suggestions)];
}

type EditMode = 'view' | 'visual' | 'raw';

export default function PolicyDetail() {
  const { name = '' } = useParams();
  const [rules, setRules] = useState('');
  const [paths, setPaths] = useState<PolicyPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>('visual');

  // Visual editor state
  const [visualRows, setVisualRows] = useState<VisualRow[]>([]);
  const [nextId, setNextId] = useState(1);

  // Raw HCL editor state
  const [rawHcl, setRawHcl] = useState('');

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Path autocomplete suggestions
  const [pathSuggestions, setPathSuggestions] = useState<string[]>([]);

  // Delete state
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  // Test panel
  const [testPanelOpen, setTestPanelOpen] = useState(false);
  const [highlightedRulePath, setHighlightedRulePath] = useState<string | null>(null);

  const isBuiltIn = name === 'root' || name === 'default';

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policy, pathData] = await Promise.all([
        api.getPolicy(name),
        api.getPolicyPaths(name),
      ]);
      setRules(policy.rules);
      setPaths(pathData.paths);
      setRawHcl(policy.rules);
      const rows = parseToVisualRows(pathData.paths);
      setVisualRows(rows);
      setNextId(rows.length + 1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => { loadPolicy(); }, [loadPolicy]);

  // Load path autocomplete suggestions once on mount (errors are non-critical)
  useEffect(() => {
    void Promise.all([
      api.getEngines().catch(() => []),
      api.getAuthMethods().catch(() => []),
    ]).then(([engines, methods]) => {
      setPathSuggestions(buildPathSuggestions(
        engines as SecretEngine[],
        methods as AuthMethod[],
      ));
    });
  }, []);

  // Switch to visual mode: parse current raw HCL client-side (preserves unsaved edits)
  const enterVisualMode = () => {
    const hclSource = editMode === 'view' ? rules : rawHcl;
    const parsed = parseHCLClientSide(hclSource);
    // Fall back to server-parsed paths if HCL is empty / un-parseable
    const rows = parsed.length > 0 ? parsed : parseToVisualRows(paths);
    setVisualRows(rows);
    setNextId(rows.length + 1);
    setEditMode('visual');
    setSaveError(null);
    setSaveSuccess(false);
  };

  // Switch to raw mode: generate HCL from visual rows if coming from visual
  const enterRawMode = () => {
    if (editMode === 'visual') {
      setRawHcl(generateHCL(visualRows));
    }
    setEditMode('raw');
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleCancel = () => {
    setRawHcl(rules);
    const rows = parseToVisualRows(paths);
    setVisualRows(rows);
    setNextId(rows.length + 1);
    setEditMode('view');
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const hcl = editMode === 'raw' ? rawHcl : generateHCL(visualRows);
      await api.updatePolicy(name, hcl);
      setSaveSuccess(true);
      // Reload the policy to reflect saved state
      await loadPolicy();
      setEditMode('view');
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete policy "${name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.deletePolicy(name);
      navigate('/policies');
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Failed to delete policy');
    } finally {
      setDeleting(false);
    }
  };

  // Visual editor helpers
  const addRow = () => {
    setVisualRows((prev) => [...prev, { id: nextId, path: '', capabilities: ['read'] }]);
    setNextId((n) => n + 1);
  };

  const removeRow = (id: number) => {
    setVisualRows((prev) => prev.filter((r) => r.id !== id));
  };

  const updatePath = (id: number, value: string) => {
    setVisualRows((prev) => prev.map((r) => (r.id === id ? { ...r, path: value } : r)));
  };

  const toggleCapability = (id: number, cap: Capability) => {
    setVisualRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const has = r.capabilities.includes(cap);
        return {
          ...r,
          capabilities: has
            ? r.capabilities.filter((c) => c !== cap)
            : [...r.capabilities, cap],
        };
      })
    );
  };

  const activeRules: PolicyRule[] =
    editMode === 'view'
      ? paths.map((p) => ({ path: p.path, capabilities: p.capabilities }))
      : editMode === 'visual'
        ? visualRows.map((r) => ({ path: r.path, capabilities: r.capabilities as string[] }))
        : parseHCLClientSide(rawHcl).map((r) => ({
            path: r.path,
            capabilities: r.capabilities as string[],
          }));

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/policies" className="text-sm text-[#1563ff] hover:text-[#1250d4]">
            ← Policies
          </Link>
          <h1 className="text-2xl font-bold text-gray-800">{name}</h1>
          {isBuiltIn && (
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">built-in</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Test policy button — always visible */}
          <button
            type="button"
            onClick={() => setTestPanelOpen((o) => !o)}
            title="Test policy"
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-sm transition-colors ${
              testPanelOpen
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.75}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15a2.25 2.25 0 01.217 1.028V19.5a2.25 2.25 0 01-2.25 2.25H6.233a2.25 2.25 0 01-2.25-2.25v-3.472c0-.384.078-.752.217-1.028M19.8 15H4.2"
              />
            </svg>
            Test
          </button>

          {!isBuiltIn && editMode === 'view' && (
            <>
              <button
                onClick={enterVisualMode}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Edit (Visual)
              </button>
              <button
                onClick={() => { setEditMode('raw'); setSaveError(null); setSaveSuccess(false); }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Edit (Raw HCL)
              </button>
              <button
                onClick={() => { void handleDelete(); }}
                disabled={deleting}
                className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete Policy'}
              </button>
            </>
          )}
          {!isBuiltIn && editMode !== 'view' && (
            <>
              {editMode === 'visual' && (
                <button
                  onClick={enterRawMode}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Switch to Raw HCL
                </button>
              )}
              {editMode === 'raw' && (
                <button
                  onClick={enterVisualMode}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Switch to Visual
                </button>
              )}
              <button
                onClick={handleCancel}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Policy'}
              </button>
            </>
          )}
        </div>
      </div>

      {saveError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Policy saved successfully.
        </div>
      )}

      {/* Split-screen layout */}
      <div className="flex items-start gap-4">
        <div className={`min-w-0 transition-all duration-1000 ${testPanelOpen ? 'w-1/2' : 'w-full'}`}>
      {/* View mode */}
      {editMode === 'view' && (
        <>
          {/* HCL Rules */}
          <div className="mb-8 rounded-md border border-gray-200">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600">
              Policy Rules (HCL)
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-sm text-gray-700 whitespace-pre-wrap">
              {rules}
            </pre>
          </div>

          {/* Parsed Paths */}
          <div className="rounded-md border border-gray-200">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600">
              Paths &amp; Capabilities
            </div>
            <div className="divide-y divide-gray-100">
              {paths.map((p) => (
                <div key={p.path} className="flex items-center px-4 py-3">
                  <span className="w-1/2 font-mono text-sm text-gray-700">{p.path}</span>
                  <div className="flex flex-wrap gap-1">
                    {p.capabilities.map((cap) => (
                      <Badge key={cap} text={cap} />
                    ))}
                  </div>
                </div>
              ))}
              {paths.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-gray-400">
                  No paths parsed from this policy
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Visual editor mode */}
      {editMode === 'visual' && (
        <div className="rounded-md border border-gray-200">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-600">Visual Policy Editor</span>
            <span className="text-xs text-gray-400">
              Changes are converted to HCL when saved. Use &quot;Switch to Raw HCL&quot; to fine-tune.
            </span>
          </div>

          {/* Capability legend */}
          <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 flex flex-wrap gap-2">
            {ALL_CAPABILITIES.map((cap) => (
              <span key={cap} className={`rounded border px-2 py-0.5 text-[11px] font-medium ${CAP_COLORS[cap]}`}>
                {cap}
              </span>
            ))}
          </div>

          {/* Path rows */}
          <div className="divide-y divide-gray-100">
            {visualRows.map((row) => {
              const isHighlighted = highlightedRulePath && row.path.trim() === highlightedRulePath.trim();
              return (
              <div 
                key={row.id} 
                className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                  isHighlighted 
                    ? 'bg-blue-50 border-l-4 border-l-blue-500' 
                    : ''
                }`}
              >
                {/* Path combobox */}
                <div className="relative w-64 shrink-0">
                  <SuggestionsCombobox
                    value={row.path}
                    onChange={(v) => updatePath(row.id, v)}
                    suggestions={pathSuggestions}
                    placeholder="e.g. kv/data/myapp/*"
                    enginePathMode
                    inputClassName="w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm focus:border-blue-400 focus:outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_CAPABILITIES.map((cap) => {
                    const active = row.capabilities.includes(cap);
                    return (
                      <button
                        key={cap}
                        type="button"
                        onClick={() => toggleCapability(row.id, cap)}
                        className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-opacity ${
                          active
                            ? CAP_COLORS[cap]
                            : 'border-gray-200 bg-white text-gray-300 hover:text-gray-500'
                        }`}
                        title={active ? `Remove ${cap}` : `Add ${cap}`}
                      >
                        {cap}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="ml-auto shrink-0 text-gray-300 hover:text-red-500"
                  title="Remove path"
                >
                  ✕
                </button>
              </div>
              );
            })}
            {visualRows.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-gray-400">
                No paths. Click &quot;Add Path&quot; to start.
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 px-4 py-3">
            <button
              type="button"
              onClick={addRow}
              className="rounded-md border border-dashed border-gray-300 px-4 py-1.5 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600"
            >
              + Add Path
            </button>
          </div>
        </div>
      )}

      {/* Raw HCL editor mode */}
      {editMode === 'raw' && (
        <div className="rounded-md border border-gray-200">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600">
            Raw HCL Editor
          </div>
          <textarea
            value={rawHcl}
            onChange={(e) => setRawHcl(e.target.value)}
            className="block w-full resize-y rounded-b-md p-4 font-mono text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
            rows={24}
            spellCheck={false}
          />
        </div>
      )}
        </div>{/* end left pane */}

        <div
          className={`shrink-0 overflow-hidden transition-all duration-1000 ${
            testPanelOpen ? 'w-1/2' : 'w-0'
          }`}
        >
          {testPanelOpen && (
            <PolicyTesterPanel
              rules={activeRules}
              isUnsaved={editMode !== 'view'}
              onClose={() => setTestPanelOpen(false)}
              onMatchedRuleChange={setHighlightedRulePath}
            />
          )}
        </div>
      </div>{/* end split-screen */}
    </div>
  );
}

