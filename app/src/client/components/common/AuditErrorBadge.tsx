import { useState } from 'react';
import FilteredAuditLog from './FilteredAuditLog';

interface AuditErrorBadgeProps {
  /** Number of audit errors to show — badge renders nothing when this is 0 */
  count: number;
  /** Auth method mount path, e.g. "kubernetes" */
  mountPath: string;
  /** Scopes the popup to a single role (e.g. "app-role") */
  roleFilter?: string;
  /** Shown in the popup title */
  label: string;
}

/** Small clickable error-count badge that opens a popup with the filtered audit log. */
export default function AuditErrorBadge({ count, mountPath, roleFilter, label }: AuditErrorBadgeProps) {
  const [open, setOpen] = useState(false);

  if (count <= 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${count} audit error${count === 1 ? '' : 's'} — click to view`}
        className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        {count}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Audit errors — {label}</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <FilteredAuditLog mountPath={mountPath} roleFilter={roleFilter} defaultErrorOnly />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
