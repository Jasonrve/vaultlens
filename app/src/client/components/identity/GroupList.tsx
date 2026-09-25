import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';

const PAGE_SIZE = 50;

export default function GroupList() {
  const [groups, setGroups] = useState<api.GroupSummaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getGroupsSummary({ search: search || undefined, offset, limit: PAGE_SIZE })
      .then((result) => {
        setGroups(result.groups);
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
        <h1 className="text-2xl font-bold text-gray-800">Groups</h1>
        <input
          type="text"
          placeholder="Search groups…"
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
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                    ID
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {groups.map(({ id, name, memberCount, policyCount }) => (
                  <tr key={id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Link
                          to={`/access/groups/${id}`}
                          className="text-sm text-[#1563ff] hover:text-[#1250d4]"
                        >
                          {name || <span className="italic text-gray-400">unnamed</span>}
                        </Link>
                        {memberCount > 0 && (
                          <span
                            title={`${memberCount} member${memberCount !== 1 ? 's' : ''}`}
                            className="text-xs text-gray-400"
                          >
                            {memberCount}m
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
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-gray-400">{id}</span>
                    </td>
                  </tr>
                ))}
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-4 py-8 text-center text-sm text-gray-400">
                      {search ? `No groups match "${search}"` : 'No groups found'}
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
