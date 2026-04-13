import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';

export default function PolicyList() {
  const [policies, setPolicies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPolicies()
      .then(setPolicies)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  }, []);

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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

