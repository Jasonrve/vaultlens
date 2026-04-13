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

  useEffect(() => {
    api
      .getRoles(method)
      .then((data) => {
        setRoles(data.roles);
        setMethodType(data.type);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  }, [method]);

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
      <div className="overflow-hidden rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Role Name
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
              </tr>
            ))}
            {roles.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-gray-400">
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

