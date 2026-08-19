import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../../lib/api';
import type { AuthMethod } from '../../types';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import AuthMethodIcon from './AuthMethodIcon';
import { AuthMethodMeta } from './AuthMethodMeta';

export default function AuthMethodList() {
  const [methods, setMethods] = useState<AuthMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api
      .getAuthMethods()
      .then(setMethods)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? methods.filter(
        (m) =>
          m.path.toLowerCase().includes(search.toLowerCase()) ||
          m.type.toLowerCase().includes(search.toLowerCase()) ||
          (m.description ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : methods;

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Auth Methods</h1>
        <input
          type="text"
          placeholder="Search auth methods…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
        />
      </div>
      <div className="overflow-hidden rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Path
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Description / Labels
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Accessor
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {filtered.map((m) => (
              <tr key={m.path} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <AuthMethodIcon type={m.type} className="h-5 w-5 shrink-0" />
                    <Link
                      to={`/access/auth-methods/${m.path.replace(/\/$/, '')}`}
                      className="text-sm font-medium text-[#1563ff] hover:text-[#1250d4]"
                    >
                      {m.path}
                    </Link>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{m.type}</td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {m.description
                    ? <AuthMethodMeta description={m.description} />
                    : '—'}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{m.accessor}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">
                  {search ? `No auth methods match "${search}"` : 'No auth methods found'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

