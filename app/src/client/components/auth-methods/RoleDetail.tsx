import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';

// Fields that contain token/security policies — rendered as badges
const POLICY_FIELDS = new Set(['token_policies', 'policies', 'allowed_policies', 'disallowed_policies']);
// Fields to display under a "Tokens" sub-heading
const TOKEN_FIELD_PREFIX = 'token_';

function formatValue(val: unknown): string {
  if (val === null || val === undefined || val === '') return '—';
  if (Array.isArray(val)) return val.length === 0 ? '—' : val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function toLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface FieldRowProps {
  label: string;
  value: unknown;
  isPolicy?: boolean;
}

function FieldRow({ label, value, isPolicy }: FieldRowProps) {
  const formatted = formatValue(value);
  return (
    <div className="flex border-b border-gray-100 px-4 py-3 last:border-0">
      <span className="w-1/2 text-sm font-medium text-gray-600">{label}</span>
      <span className="w-1/2 text-sm text-gray-800 break-all">
        {isPolicy && Array.isArray(value) && value.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {(value as string[]).map((p) => (
              <span key={p} className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                {p}
              </span>
            ))}
          </span>
        ) : (
          formatted
        )}
      </span>
    </div>
  );
}

export default function RoleDetail() {
  const { method = '', role = '' } = useParams();
  const [roleData, setRoleData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRole(method, role)
      .then((result) => setRoleData(result.data))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  }, [method, role]);

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} />;
  if (!roleData) return <ErrorMessage message="No role data found" />;

  const allEntries = Object.entries(roleData);
  const generalFields = allEntries.filter(([k]) => !k.startsWith(TOKEN_FIELD_PREFIX));
  const tokenFields = allEntries.filter(([k]) => k.startsWith(TOKEN_FIELD_PREFIX));

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
        <Link to="/access/auth-methods" className="hover:text-[#1563ff]">Auth Methods</Link>
        <span>/</span>
        <Link to={`/access/auth-methods/${method}/roles`} className="hover:text-[#1563ff]">{method}</Link>
        <span>/</span>
        <span>roles</span>
        <span>/</span>
        <span className="text-gray-700">{role}</span>
      </div>

      <h1 className="mb-6 text-2xl font-bold text-gray-800">{role}</h1>

      {/* General fields */}
      {generalFields.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-md border border-gray-200 bg-white">
          {generalFields.map(([key, val]) => (
            <FieldRow
              key={key}
              label={toLabel(key)}
              value={val}
              isPolicy={POLICY_FIELDS.has(key)}
            />
          ))}
        </div>
      )}

      {/* Token fields */}
      {tokenFields.length > 0 && (
        <>
          <h2 className="mb-3 text-base font-semibold text-gray-700">Tokens</h2>
          <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
            {tokenFields.map(([key, val]) => (
              <FieldRow
                key={key}
                label={toLabel(key)}
                value={val}
                isPolicy={POLICY_FIELDS.has(key)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

