import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import AuditErrorBadge from '../common/AuditErrorBadge';

interface AppRoleForm {
  bindSecretId: boolean;
  secretIdTtl: string;
  secretIdNumUses: string;
  localSecretIds: boolean;
  tokenTtl: string;
  tokenMaxTtl: string;
  tokenPolicies: string;
  tokenType: string;
  tokenNumUses: string;
}

const defaultAppRoleForm: AppRoleForm = {
  bindSecretId: true,
  secretIdTtl: '',
  secretIdNumUses: '0',
  localSecretIds: false,
  tokenTtl: '',
  tokenMaxTtl: '',
  tokenPolicies: '',
  tokenType: 'default',
  tokenNumUses: '0',
};

function appRoleFormToBody(form: AppRoleForm): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  body.bind_secret_id = form.bindSecretId;
  if (form.localSecretIds) body.local_secret_ids = true;
  if (form.secretIdTtl.trim()) body.secret_id_ttl = form.secretIdTtl.trim();
  const secretUses = parseInt(form.secretIdNumUses, 10);
  if (!isNaN(secretUses)) body.secret_id_num_uses = secretUses;
  if (form.tokenTtl.trim()) body.token_ttl = form.tokenTtl.trim();
  if (form.tokenMaxTtl.trim()) body.token_max_ttl = form.tokenMaxTtl.trim();
  const policies = form.tokenPolicies.split(',').map((p) => p.trim()).filter(Boolean);
  if (policies.length > 0) body.token_policies = policies;
  if (form.tokenType && form.tokenType !== 'default') body.token_type = form.tokenType;
  const tokenUses = parseInt(form.tokenNumUses, 10);
  if (!isNaN(tokenUses) && tokenUses > 0) body.token_num_uses = tokenUses;
  return body;
}

interface RoleListProps {
  embedded?: boolean;
  errorCounts?: api.AuditErrorCounts | null;
}

export default function RoleList({ embedded = false, errorCounts = null }: RoleListProps) {
  const { method = '' } = useParams();
  const [roles, setRoles] = useState<string[]>([]);
  const [methodType, setMethodType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create role state
  const [showCreate, setShowCreate] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleJson, setNewRoleJson] = useState('{}');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [appRoleForm, setAppRoleForm] = useState<AppRoleForm>(defaultAppRoleForm);
  const [useJsonMode, setUseJsonMode] = useState(false);

  // Delete state
  const [deletingRole, setDeletingRole] = useState<string | null>(null);

  function loadRoles() {
    setLoading(true);
    api
      .getRoles(method)
      .then((data) => {
        setRoles(data.roles);
        setMethodType(data.type);
      })
      .catch((e: unknown) => {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 403) {
          setError('permission denied');
        } else {
          setError(e instanceof Error ? e.message : 'An error occurred');
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadRoles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);

  async function handleCreate() {
    const name = newRoleName.trim();
    if (!name) { setCreateError('Role name is required'); return; }
    let body: Record<string, unknown> = {};
    if (methodType === 'approle' && !useJsonMode) {
      body = appRoleFormToBody(appRoleForm);
    } else {
      try {
        body = JSON.parse(newRoleJson) as Record<string, unknown>;
      } catch {
        setCreateError('Invalid JSON configuration');
        return;
      }
    }
    setCreating(true);
    setCreateError(null);
    try {
      await api.createOrUpdateRole(method, name, body);
      setShowCreate(false);
      setNewRoleName('');
      setNewRoleJson('{}');
      setAppRoleForm(defaultAppRoleForm);
      setUseJsonMode(false);
      loadRoles();
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create role');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(role: string) {
    if (!window.confirm(`Delete role "${role}"? This cannot be undone.`)) return;
    setDeletingRole(role);
    try {
      await api.deleteRole(method, role);
      setRoles((prev) => prev.filter((r) => r !== role));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete role');
    } finally {
      setDeletingRole(null);
    }
  }

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return error === 'permission denied'
    ? (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        You do not have permission to list roles for this auth method.
      </div>
    )
    : <ErrorMessage message={error} />;

  return (
    <div>
      {!embedded && (
        <div className="mb-6 flex items-center gap-3">
          <Link to="/access/auth-methods" className="text-sm text-[#1563ff] hover:text-[#1250d4]">
            ← Auth Methods
          </Link>
          <h1 className="text-2xl font-bold text-gray-800">
            {method} <span className="text-base font-normal text-gray-400">({methodType})</span>
          </h1>
        </div>
      )}

      <div className="mb-3 flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-[#1563ff] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1250d4]"
        >
          + Create Role
        </button>
      </div>

      {showCreate && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">New Role</h3>
            {methodType === 'approle' && (
              <button
                type="button"
                onClick={() => {
                  if (!useJsonMode) setNewRoleJson(JSON.stringify(appRoleFormToBody(appRoleForm), null, 2));
                  setUseJsonMode((v) => !v);
                }}
                className="text-xs text-[#1563ff] hover:text-[#1250d4]"
              >
                {useJsonMode ? '← Form mode' : 'JSON mode →'}
              </button>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Role Name</label>
            <input
              type="text"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="my-role"
            />
          </div>

          {methodType === 'approle' && !useJsonMode ? (
            <>
              {/* Secret ID settings */}
              <div className="pt-2 border-t border-gray-100">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Secret ID</p>
                <div className="space-y-2.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={appRoleForm.bindSecretId}
                      onChange={(e) => setAppRoleForm((f) => ({ ...f, bindSecretId: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">Require Secret ID on login</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">TTL</label>
                      <input
                        type="text"
                        value={appRoleForm.secretIdTtl}
                        onChange={(e) => setAppRoleForm((f) => ({ ...f, secretIdTtl: e.target.value }))}
                        placeholder="e.g. 1h, 30m (blank = ∞)"
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Max uses per Secret ID</label>
                      <input
                        type="number"
                        min={0}
                        value={appRoleForm.secretIdNumUses}
                        onChange={(e) => setAppRoleForm((f) => ({ ...f, secretIdNumUses: e.target.value }))}
                        placeholder="0 = unlimited"
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={appRoleForm.localSecretIds}
                      onChange={(e) => setAppRoleForm((f) => ({ ...f, localSecretIds: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">Cluster-local Secret IDs</span>
                    <span className="text-xs text-gray-400">(performance replication only)</span>
                  </label>
                </div>
              </div>

              {/* Token settings */}
              <div className="pt-2 border-t border-gray-100">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Token</p>
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">TTL</label>
                      <input
                        type="text"
                        value={appRoleForm.tokenTtl}
                        onChange={(e) => setAppRoleForm((f) => ({ ...f, tokenTtl: e.target.value }))}
                        placeholder="e.g. 1h (blank = default)"
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Max TTL</label>
                      <input
                        type="text"
                        value={appRoleForm.tokenMaxTtl}
                        onChange={(e) => setAppRoleForm((f) => ({ ...f, tokenMaxTtl: e.target.value }))}
                        placeholder="e.g. 24h (blank = default)"
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Policies</label>
                    <input
                      type="text"
                      value={appRoleForm.tokenPolicies}
                      onChange={(e) => setAppRoleForm((f) => ({ ...f, tokenPolicies: e.target.value }))}
                      placeholder="default, my-policy (comma-separated)"
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Token Type</label>
                      <select
                        value={appRoleForm.tokenType}
                        onChange={(e) => setAppRoleForm((f) => ({ ...f, tokenType: e.target.value }))}
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="default">default</option>
                        <option value="service">service</option>
                        <option value="batch">batch</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Max uses per token</label>
                      <input
                        type="number"
                        min={0}
                        value={appRoleForm.tokenNumUses}
                        onChange={(e) => setAppRoleForm((f) => ({ ...f, tokenNumUses: e.target.value }))}
                        placeholder="0 = unlimited"
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Configuration (JSON)</label>
              <textarea
                value={newRoleJson}
                onChange={(e) => setNewRoleJson(e.target.value)}
                rows={4}
                className="w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          )}

          {createError && <p className="text-xs text-red-600">{createError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => { void handleCreate(); }}
              disabled={creating}
              className="rounded bg-[#1563ff] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1250d4] disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateError(null); setAppRoleForm(defaultAppRoleForm); setUseJsonMode(false); }}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Role Name
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {roles.map((role) => (
              <tr key={role} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    to={`/access/auth-methods/${method}/roles/${role}`}
                    className="text-sm font-medium text-[#1563ff] hover:text-[#1250d4]"
                  >
                    {role}
                  </Link>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <AuditErrorBadge count={errorCounts?.byRole[role] ?? 0} mountPath={method} roleFilter={role} label={role} />
                    <button
                      onClick={() => { void handleDelete(role); }}
                      disabled={deletingRole === role}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                    >
                      {deletingRole === role ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {roles.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-sm text-gray-400">
                  No roles found for this auth method
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

