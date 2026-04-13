import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as api from '../../lib/api';
import type { PolicyPath } from '../../types';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import Badge from '../common/Badge';

export default function PolicyDetail() {
  const { name = '' } = useParams();
  const [rules, setRules] = useState('');
  const [paths, setPaths] = useState<PolicyPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getPolicy(name), api.getPolicyPaths(name)])
      .then(([policy, pathData]) => {
        setRules(policy.rules);
        setPaths(pathData.paths);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  }, [name]);

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link to="/policies" className="text-sm text-[#1563ff] hover:text-[#1250d4]">
          ← Policies
        </Link>
        <h1 className="text-2xl font-bold text-gray-800">{name}</h1>
      </div>

      {/* HCL Rules */}
      <div className="mb-8 rounded-md border border-gray-200">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600">
          Policy Rules (HCL)
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-sm text-gray-700 whitespace-pre-wrap">
          {rules}
        </pre>
      </div>

      {/* Parsed Paths */}
      <div className="rounded-md border border-gray-200">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600">
          Paths &amp; Capabilities
        </div>
        <div className="divide-y divide-gray-100">
          {paths.map((p) => (
            <div key={p.path} className="flex items-center px-4 py-3">
              <span className="w-1/2 font-mono text-sm text-gray-700">{p.path}</span>
              <div className="flex flex-wrap gap-1">
                {p.capabilities.map((cap) => (
                  <Badge key={cap} text={cap} />
                ))}
              </div>
            </div>
          ))}
          {paths.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              No paths parsed from this policy
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

