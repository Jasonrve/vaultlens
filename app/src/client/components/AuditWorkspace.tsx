import { AuditDraftProvider } from './AuditDraftContext';
import { NavLink, Outlet, useSearchParams } from 'react-router-dom';

export default function AuditWorkspace() {
  const [params] = useSearchParams();
  const run = params.get('run');
  const search = run ? `?${new URLSearchParams({ run })}` : '';
  return (
    <AuditDraftProvider>
      <div className="space-y-5">
        <header>
          <h1 className="text-xl font-semibold text-gray-900">
            Security Audit
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Configuration risks, policy assignments and authentication checks.
          </p>
        </header>
        <nav
          aria-label="Security Audit sections"
          className="flex gap-6 overflow-x-auto border-b border-gray-200"
        >
          {(
            [
              ['findings', 'Findings'],
              ['runs', 'Runs'],
              ['reports', 'Reports'],
              ['checks', 'Checks'],
              ['exceptions', 'Exceptions'],
              ['sources', 'Sources'],
            ] as const
          ).map(([path, label]) => (
            <NavLink
              key={path}
              to={{ pathname: `/security-audit/${path}`, search }}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium ${isActive ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
    </AuditDraftProvider>
  );
}
