import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { GraphNode } from '../../types';
import GraphWrapper from './GraphWrapper';
import GraphTableView from './GraphTableView';
import GraphExplorer from './GraphExplorer';

const nodeColors: Record<string, string> = {
  authMethod: '#7c3aed',
  role: '#f59e0b',
  policy: '#10b981',
  secretPath: '#60A5FA',
};

const MAX_SUGGESTIONS = 20;
// Below this many root nodes, just show everything — search only earns its
// keep once there's too much to render/scan at once.
const SHOW_ALL_THRESHOLD = 20;

interface Props {
  refreshKey?: number;
  onDataLoaded?: (cachedAt: number | undefined, fromCache: boolean) => void;
}

export default function AuthPolicyGraph({ refreshKey = 0, onDataLoaded }: Props) {
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const [search, setSearch] = useState('');
  const [selectedMount, setSelectedMount] = useState<string | null>(null);

  // Summary only (one node per auth mount + role count) — roles/policies are
  // fetched on demand via onExpandNode below, not up front.
  const { data: graphData, isLoading, error } = useQuery({
    queryKey: ['auth-policy-map', refreshKey],
    queryFn: () => api.getAuthPolicyMap({ refresh: refreshKey > 0 }),
  });

  useEffect(() => {
    if (graphData) onDataLoaded?.(graphData.cachedAt, graphData.fromCache ?? false);
  }, [graphData, onDataLoaded]);

  const totalMounts = graphData?.nodes.length ?? 0;
  const showAll = totalMounts > 0 && totalMounts <= SHOW_ALL_THRESHOLD;

  const suggestions = useMemo(() => {
    if (!graphData || !search.trim()) return [];
    const term = search.trim().toLowerCase();
    return graphData.nodes
      .filter((n) => n.data.label.toLowerCase().includes(term))
      .slice(0, MAX_SUGGESTIONS);
  }, [graphData, search]);

  const displayData = useMemo(() => {
    if (showAll) return graphData ?? null;
    if (!selectedMount || !graphData) return null;
    const node = graphData.nodes.find((n) => n.id === selectedMount);
    return node ? { nodes: [node], edges: [] } : null;
  }, [showAll, selectedMount, graphData]);

  const onExpandNode = useCallback(async (node: GraphNode) => {
    if (node.type === 'authMethod') {
      if (!node.data.hasRoles) return null;
      const mount = node.id.replace(/^auth-/, '');
      return api.getAuthPolicyMap({ mount });
    }
    if (node.type === 'role') {
      const method = node.data.method as string | undefined;
      if (!method) return null;
      return api.getAuthPolicyMap({ mount: method, role: node.data.label as string });
    }
    return null;
  }, []);

  const errorMessage = error ? (error instanceof Error ? error.message : 'An error occurred') : null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-700">Auth Methods → Roles → Policies</h2>
        <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
          <button
            onClick={() => setView('graph')}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              view === 'graph' ? 'bg-white text-[#1563ff] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Graph
          </button>
          <button
            onClick={() => setView('table')}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              view === 'table' ? 'bg-white text-[#1563ff] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Table
          </button>
        </div>
      </div>
      {!showAll && (
        <div className="relative mb-3">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedMount(null);
            }}
            placeholder={`Search ${totalMounts || ''} auth method${totalMounts === 1 ? '' : 's'} by name…`}
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {search && !selectedMount && suggestions.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-72 w-full max-w-md overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {suggestions.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setSelectedMount(n.id);
                    setSearch(n.data.label);
                  }}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  {n.data.label}
                </button>
              ))}
            </div>
          )}
          {search && !selectedMount && suggestions.length === 0 && !isLoading && (
            <p className="mt-1 text-xs text-gray-400">No auth methods match &ldquo;{search}&rdquo;</p>
          )}
        </div>
      )}

      {view === 'graph' && (
        <>
          <div className="mb-3 flex gap-4 text-xs text-gray-500">
            {Object.entries(nodeColors).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded" style={{ background: color }} />
                {type}
              </span>
            ))}
          </div>
          <GraphExplorer
            data={displayData}
            nodeColors={nodeColors}
            loading={isLoading}
            error={errorMessage}
            onExpandNode={onExpandNode}
            emptyPrompt={showAll ? undefined : 'Search for an auth method above to see its roles and policies.'}
          />
        </>
      )}
      {view === 'table' && graphData && (
        <GraphTableView data={graphData} diagramType="auth-policy" />
      )}
      {view === 'table' && !graphData && !isLoading && (
        <GraphWrapper loading={isLoading} error={errorMessage}>{null}</GraphWrapper>
      )}
    </div>
  );
}
