import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';

export default function EntityList() {
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getEntitiesSummary()
      .then(setEntities)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-800">Entities</h1>
      <div className="overflow-hidden rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                ID
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {entities.map(({ id, name }) => (
              <tr key={id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    to={`/access/entities/${id}`}
                    className="text-sm text-[#1563ff] hover:text-[#1250d4]"
                  >
                    {name || <span className="italic text-gray-400">unnamed</span>}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-gray-400">{id}</span>
                </td>
              </tr>
            ))}
            {entities.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-sm text-gray-400">
                  No entities found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

