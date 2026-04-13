import { useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

const LABELS: Record<string, string> = {
  access: 'Access',
  'auth-methods': 'Auth Methods',
  entities: 'Entities',
  groups: 'Groups',
  policies: 'Policies',
  secrets: 'Secrets',
  visualizations: 'Visualizations',
  admin: 'Admin',
  branding: 'Branding',
  'permission-tester': 'Permission Tester',
  tools: 'Tools',
  share: 'Share Secret',
};

export default function Header() {
  const location = useLocation();
  const { tokenInfo, logout } = useAuthStore();

  const segments = location.pathname.split('/').filter(Boolean);

  const toLabel = (seg: string) =>
    LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ');

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1 text-sm">
        <Link to="/" className="font-medium text-gray-500 hover:text-[#1563ff]">Home</Link>
        {segments.map((seg, i) => {
          const path = '/' + segments.slice(0, i + 1).join('/');
          const isLast = i === segments.length - 1;
          return (
            <span key={i} className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              {isLast ? (
                <span className="font-medium text-gray-800">{toLabel(seg)}</span>
              ) : (
                <Link to={path} className="text-gray-500 hover:text-[#1563ff]">{toLabel(seg)}</Link>
              )}
            </span>
          );
        })}
      </nav>

      {/* Right */}
      <div className="flex items-center gap-3">
        {tokenInfo?.display_name && (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
            {tokenInfo.display_name}
          </span>
        )}
        <button
          onClick={() => { void logout(); }}
          className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}