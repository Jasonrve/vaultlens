import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';

const BUILT_IN = new Set(['root', 'default']);

export default function PolicyList() {
  const navigate = useNavigate();
  const [policies, setPolicies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadPolicies = () => {
    api
      .getPolicies()
      .then(setPolicies)
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

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-800">ACL Policies</h1>
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
            {policies.map((name) => (
              <tr key={name} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    to={`/policies/${name}`}
                    className="text-sm font-medium text-[#1563ff] hover:text-[#1250d4]"
                  >
                    {name}
                  </Link>
                  {BUILT_IN.has(name) && (
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">built-in</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {!BUILT_IN.has(name) && (
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


