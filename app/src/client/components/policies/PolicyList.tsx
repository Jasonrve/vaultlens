import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';

const BUILT_IN = new Set(['root', 'default']);

export default function PolicyList() {
  const navigate = useNavigate();
  const [policies, setPolicies] = useState<string[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadPolicies = () => {
    api
      .getPolicies()
      .then((result) => {
        setPolicies(result.policies);
        setRestricted(result.restricted === true);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadPolicies(); }, []);

  const handleDelete = async (name: string) => {
    if (!window.confirm(`Delete policy "${name}"? This cannot be undone.`)) return;
    setDeleting(name);
    try {
      await api.deletePolicy(name);
      setPolicies((prev) => prev.filter((p) => p !== name));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete policy');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} />;

  const filtered = search
    ? policies.filter((p) => p.toLowerCase().includes(search.toLowerCase()))
    : policies;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800">ACL Policies</h1>
        <input
          type="text"
          placeholder="Search policies…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
        />
      </div>
      {restricted && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span>
            <strong>Restricted view</strong> — you do not have permission to list all policies.
            Showing only the policies attached to your identity.
          </span>
        </div>
      )}
      <div className="overflow-hidden rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Policy Name
              </th>
              <th className="px-4 py-3 w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-sm text-gray-400">
                  {search
                    ? <>No policies match &ldquo;{search}&rdquo;</>
                    : restricted
                      ? 'No policies are attached to your identity.'
                      : 'No policies found.'}
                </td>
              </tr>
            )}
            {filtered.map((name) => (
              <tr key={name} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    to={restricted ? `/policies/${name}?readonly=1` : `/policies/${name}`}
                    className="text-sm font-medium text-[#1563ff] hover:text-[#1250d4]"
                  >
                    {name}
                  </Link>
                  {BUILT_IN.has(name) && (
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">built-in</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {!BUILT_IN.has(name) && !restricted && (
                    <button
                      onClick={() => { void handleDelete(name); }}
                      disabled={deleting === name}
                      className="rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-500 hover:bg-red-50 disabled:opacity-40"
                      title={`Delete policy "${name}"`}
                    >
                      {deleting === name ? '…' : 'Delete'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <div className="mt-3 text-sm text-red-600">{error}</div>
      )}
    </div>
  );
}


