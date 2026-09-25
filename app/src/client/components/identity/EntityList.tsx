import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';

const PAGE_SIZE = 50;

export default function EntityList() {
  const [entities, setEntities] = useState<api.EntitySummaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getEntitiesSummary({ search: search || undefined, offset, limit: PAGE_SIZE })
      .then((result) => {
        setEntities(result.entities);
        setTotal(result.total);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  }, [search, offset]);

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);

  if (error) return <ErrorMessage message={error} />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Entities</h1>
        <input
          type="text"
          placeholder="Search entities…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
        />
      </div>
      {loading ? (
        <LoadingSpinner className="mt-12" />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                    Name / Alias
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {entities.map(({ id, name, aliasName, groupCount, policyCount }) => (
                  <tr key={id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <Link
                            to={`/access/entities/${id}`}
                            className="text-sm text-[#1563ff] hover:text-[#1250d4]"
                          >
                            {aliasName || name || <span className="italic text-gray-400">unnamed</span>}
                          </Link>
                          <span className="font-mono text-xs text-gray-400">({id})</span>
                          {groupCount > 0 && (
                            <span
                              title={`${groupCount} group${groupCount !== 1 ? 's' : ''}`}
                              className="text-xs text-gray-400"
                            >
                              {groupCount}g
                            </span>
                          )}
                          {policyCount > 0 && (
                            <span
                              title={`${policyCount} polic${policyCount !== 1 ? 'ies' : 'y'}`}
                              className="text-xs text-gray-400"
                            >
                              {policyCount}p
                            </span>
                          )}
                        </div>
                        {aliasName && name && aliasName !== name && (
                          <span className="text-xs text-gray-400">{name}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {entities.length === 0 && (
                  <tr>
                    <td colSpan={1} className="px-4 py-8 text-center text-sm text-gray-400">
                      {search ? `No entities match "${search}"` : 'No entities found'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
              <span>
                Showing {rangeStart}-{rangeEnd} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total}
                  className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
