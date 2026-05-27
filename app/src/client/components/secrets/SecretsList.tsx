import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import Breadcrumb from '../common/Breadcrumb';
import SecretPathRelationshipModal from '../common/SecretPathRelationshipModal';

export default function SecretsList() {
  const { '*': splat = '' } = useParams();
  const navigate = useNavigate();
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRelGraph, setShowRelGraph] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

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
  // Ensure trailing slash for correct path construction from breadcrumb links without trailing slash
  const normalizedSplat = splat.endsWith('/') ? splat : (splat ? `${splat}/` : '');
  const breadcrumbItems = [
    { label: 'Secrets Engines', path: '/secrets' },
    ...segments.map((seg, i) => ({
      label: seg,
      path: `/secrets/${segments.slice(0, i + 1).join('/')}`,
    })),
  ];

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div>
      {showRelGraph && (
        <SecretPathRelationshipModal
          path={showRelGraph}
          onClose={() => setShowRelGraph(null)}
        />
      )}
      <div className="mb-4">
        <Breadcrumb items={breadcrumbItems} />
      </div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">
          {enginePath || 'Secrets'}
        </h1>
        <button
          onClick={() => navigate(`/secrets/create/${normalizedSplat}`)}
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
              <th className="w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {keys.map((key) => {
              const isFolder = key.endsWith('/');
              const linkPath = isFolder
                ? `/secrets/${normalizedSplat}${key}`
                : `/secrets/view/${normalizedSplat}${key}`;
              // Full Vault path for relationship lookup (without /data/ prefix — use raw path)
              const fullPath = `${normalizedSplat}${key}`;
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
                  <td className="w-20 px-2 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!isFolder && (
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(fullPath);
                              setCopiedPath(fullPath);
                              setTimeout(() => setCopiedPath(null), 2000);
                            } catch {
                              // clipboard not available
                            }
                          }}
                          title="Copy path"
                          className="text-gray-300 hover:text-gray-500 transition-colors"
                          aria-label={`Copy path ${fullPath}`}
                        >
                          {copiedPath === fullPath ? (
                            <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                            </svg>
                          )}
                        </button>
                      )}
                      {!isFolder && (
                        <button
                          onClick={() => setShowRelGraph(fullPath)}
                          title="View access relationships"
                          className="text-gray-300 hover:text-gray-500 transition-colors"
                          aria-label={`View relationships for ${key}`}
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                          >
                            <circle cx="6" cy="12" r="2" />
                            <circle cx="18" cy="6" r="2" />
                            <circle cx="18" cy="18" r="2" />
                            <path strokeLinecap="round" d="M8 11.2l8-4" />
                            <path strokeLinecap="round" d="M8 12.8l8 4" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {keys.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-sm text-gray-400">
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

