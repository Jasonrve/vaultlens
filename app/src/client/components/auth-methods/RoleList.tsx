import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';

export default function RoleList({ embedded = false }: { embedded?: boolean }) {
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
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
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
    try {
      body = JSON.parse(newRoleJson) as Record<string, unknown>;
    } catch {
      setCreateError('Invalid JSON configuration');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await api.createOrUpdateRole(method, name, body);
      setShowCreate(false);
      setNewRoleName('');
      setNewRoleJson('{}');
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
  if (error) return <ErrorMessage message={error} />;

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
          <h3 className="text-sm font-semibold text-gray-800">New Role</h3>
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
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Configuration (JSON)</label>
            <textarea
              value={newRoleJson}
              onChange={(e) => setNewRoleJson(e.target.value)}
              rows={4}
              className="w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
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
              onClick={() => { setShowCreate(false); setCreateError(null); }}
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
                  <button
                    onClick={() => { void handleDelete(role); }}
                    disabled={deletingRole === role}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    {deletingRole === role ? 'Deleting…' : 'Delete'}
                  </button>
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

