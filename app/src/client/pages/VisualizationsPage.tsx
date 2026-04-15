import { useCallback, useState } from 'react';
import AuthPolicyGraph from '../components/graphs/AuthPolicyGraph';
import PolicySecretGraph from '../components/graphs/PolicySecretGraph';
import IdentityGraph from '../components/graphs/IdentityGraph';

const tabs = [
  { id: 'auth-policy', label: 'Auth → Role → Policy' },
  { id: 'policy-secret', label: 'Policy → Secret Path' },
  { id: 'identity', label: 'Identity' },
] as const;

type TabId = (typeof tabs)[number]['id'];

interface TabCacheInfo {
  cachedAt: number | undefined;
  fromCache: boolean;
}

function formatAge(cachedAt: number): string {
  const ageMs = Date.now() - cachedAt;
  if (ageMs < 60_000) return 'just now';
  const mins = Math.floor(ageMs / 60_000);
  return `${mins}m ago`;
}

export default function VisualizationsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('auth-policy');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<Partial<Record<TabId, TabCacheInfo>>>({});

  const handleDataLoaded = useCallback(
    (tab: TabId) => (cachedAt: number | undefined, fromCache: boolean) => {
      setCacheInfo((prev) => ({ ...prev, [tab]: { cachedAt, fromCache } }));
      setIsRefreshing(false);
    },
    []
  );

  const handleRefresh = () => {
    setIsRefreshing(true);
    setRefreshKey((k) => k + 1);
  };

  const currentCache = cacheInfo[activeTab];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Visualizations</h1>
        <div className="flex items-center gap-3">
          {currentCache?.cachedAt && (
            <span className="text-xs text-gray-400">
              {currentCache.fromCache ? '📦 Cached' : '✅ Live'}{' '}
              · updated {formatAge(currentCache.cachedAt)}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50"
          >
            <svg
              className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div className="mb-6 flex border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-[#1563ff] text-[#1563ff]'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'auth-policy' && (
        <AuthPolicyGraph
          refreshKey={refreshKey}
          onDataLoaded={handleDataLoaded('auth-policy')}
        />
      )}
      {activeTab === 'policy-secret' && (
        <PolicySecretGraph
          refreshKey={refreshKey}
          onDataLoaded={handleDataLoaded('policy-secret')}
        />
      )}
      {activeTab === 'identity' && (
        <IdentityGraph
          refreshKey={refreshKey}
          onDataLoaded={handleDataLoaded('identity')}
        />
      )}
    </div>
  );
}


