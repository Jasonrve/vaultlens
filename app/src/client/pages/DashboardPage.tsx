import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import LoadingSpinner from '../components/common/LoadingSpinner';

export default function DashboardPage() {
  const [stats, setStats] = useState({ engines: 0, policies: 0, authMethods: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getEngines(), api.getPolicies(), api.getAuthMethods()])
      .then(([engines, policies, authMethods]) => {
        setStats({
          engines: engines.length,
          policies: policies.length,
          authMethods: authMethods.length,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner className="mt-12" />;

  const cards = [
    { title: 'Secret Engines', count: stats.engines, link: '/secrets', sub: 'Manage secret backends' },
    { title: 'ACL Policies', count: stats.policies, link: '/policies', sub: 'Access control policies' },
    { title: 'Auth Methods', count: stats.authMethods, link: '/access/auth-methods', sub: 'Authentication backends' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Overview</h1>
        <p className="mt-1 text-sm text-gray-500">Visual interface for HashiCorp Vault</p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.title}
            to={card.link}
            className="group rounded-lg border border-gray-200 bg-white p-5 transition-all hover:border-[#1563ff]/40 hover:shadow-sm"
          >
            <div className="text-3xl font-semibold tabular-nums text-gray-900">{card.count}</div>
            <div className="mt-1 text-sm font-medium text-gray-700">{card.title}</div>
            <div className="mt-0.5 text-xs text-gray-400">{card.sub}</div>
          </Link>
        ))}
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Quick Navigation</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: 'Browse Secrets', to: '/secrets' },
          { label: 'ACL Policies', to: '/policies' },
          { label: 'Auth Methods', to: '/access/auth-methods' },
          { label: 'Entities', to: '/access/entities' },
          { label: 'Groups', to: '/access/groups' },
          { label: 'Visualizations', to: '/visualizations' },
        ].map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-[#1563ff] transition-colors hover:border-[#1563ff]/40 hover:bg-blue-50/40"
          >
            {link.label}
            <svg className="h-4 w-4 opacity-60" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
  );
}