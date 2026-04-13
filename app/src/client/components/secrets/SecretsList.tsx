import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import Breadcrumb from '../common/Breadcrumb';

export default function SecretsList() {
  const { '*': splat = '' } = useParams();
  const navigate = useNavigate();
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .listSecrets(splat)
      .then((data) => setKeys(data.keys))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  }, [splat]);

  const segments = splat.split('/').filter(Boolean);
  const enginePath = segments[0] ? segments[0] + '/' : '';
  const breadcrumbItems = [
    { label: 'Secrets Engines', path: '/secrets' },
    ...segments.map((seg, i) => ({
      label: seg,
      path: i < segments.length - 1 ? `/secrets/${segments.slice(0, i + 1).join('/')}/` : undefined,
    })),
  ];

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div>
      <div className="mb-4">
        <Breadcrumb items={breadcrumbItems} />
      </div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">
          {enginePath || 'Secrets'}
        </h1>
        <button
          onClick={() => navigate(`/secrets/create/${splat}`)}
          className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#1250d4]"
        >
          Create secret +
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Key
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {keys.map((key) => {
              const isFolder = key.endsWith('/');
              const linkPath = isFolder
                ? `/secrets/${splat}${key}`
                : `/secrets/view/${splat}${key}`;
              return (
                <tr key={key} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      to={linkPath}
                      className="flex items-center gap-2 text-sm text-[#1563ff] hover:text-[#1250d4]"
                    >
                      <span>{isFolder ? '📁' : '🔑'}</span>
                      <span className={isFolder ? 'font-medium' : ''}>{key}</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
            {keys.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-gray-400">
                  No secrets found at this path
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

