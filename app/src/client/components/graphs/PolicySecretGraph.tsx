import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { GraphNode } from '../../types';
import GraphWrapper from './GraphWrapper';
import GraphTableView from './GraphTableView';
import GraphExplorer from './GraphExplorer';

const nodeColors: Record<string, string> = {
  policy: '#10b981',
  secretPath: '#60A5FA',
};

const legendItems = [
  { label: 'policy', color: '#10b981' },
  { label: 'secret path', color: '#60A5FA' },
  { label: 'auth backend path', color: '#7c3aed', emoji: '🔒' },
];

const MAX_SUGGESTIONS = 20;
// Below this many root nodes, just show everything — search only earns its
// keep once there's too much to render/scan at once.
const SHOW_ALL_THRESHOLD = 20;

interface Props {
  refreshKey?: number;
  onDataLoaded?: (cachedAt: number | undefined, fromCache: boolean) => void;
}

export default function PolicySecretGraph({ refreshKey = 0, onDataLoaded }: Props) {
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const [search, setSearch] = useState('');
  const [selectedPolicy, setSelectedPolicy] = useState<string | null>(null);

  // Cheap summary — policy names only, no path fan-out. Powers the search box.
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useQuery({
    queryKey: ['policy-secret-map', refreshKey],
    queryFn: () => api.getPolicySecretMap({ refresh: refreshKey > 0 }),
  });

  // The selected policy's own secret paths — this is what actually renders.
  const {
    data: graphData,
    isLoading: policyLoading,
    error: policyError,
  } = useQuery({
    queryKey: ['policy-secret-map', 'policy', selectedPolicy, refreshKey],
    queryFn: () => api.getPolicySecretMap({ policy: selectedPolicy!, refresh: refreshKey > 0 }),
    enabled: Boolean(selectedPolicy),
  });

  useEffect(() => {
    if (graphData) onDataLoaded?.(graphData.cachedAt, graphData.fromCache ?? false);
  }, [graphData, onDataLoaded]);

  const suggestions = useMemo(() => {
    if (!summary || !search.trim()) return [];
    const term = search.trim().toLowerCase();
    return summary.nodes
      .map((n) => n.data.label as string)
      .filter((name) => name.toLowerCase().includes(term))
      .slice(0, MAX_SUGGESTIONS);
  }, [summary, search]);

  const totalPolicies = summary?.nodes.length ?? 0;
  const showAll = totalPolicies > 0 && totalPolicies <= SHOW_ALL_THRESHOLD;

  const onExpandNode = useCallback(async (node: GraphNode) => {
    if (node.type !== 'policy') return null;
    return api.getPolicySecretMap({ policy: node.data.label as string });
  }, []);

  const errorMessage = policyError
    ? (policyError instanceof Error ? policyError.message : 'An error occurred')
    : summaryError
      ? (summaryError instanceof Error ? summaryError.message : 'An error occurred')
      : null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-700">Policies Secret Paths</h2>
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
              setSelectedPolicy(null);
            }}
            placeholder={`Search ${totalPolicies || ''} polic${totalPolicies === 1 ? 'y' : 'ies'} by name…`}
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {search && !selectedPolicy && suggestions.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-72 w-full max-w-md overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {suggestions.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    setSelectedPolicy(name);
                    setSearch(name);
                  }}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          {search && !selectedPolicy && suggestions.length === 0 && !summaryLoading && (
            <p className="mt-1 text-xs text-gray-400">No policies match &ldquo;{search}&rdquo;</p>
          )}
        </div>
      )}

      {view === 'graph' && (
        <>
          <div className="mb-3 flex gap-4 text-xs text-gray-500">
            {legendItems.map(({ label, color, emoji }) => (
              <span key={label} className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded" style={{ background: color }} />
                {label}{emoji ? ` ${emoji}` : ''}
              </span>
            ))}
          </div>
          <GraphExplorer
            data={selectedPolicy ? (graphData ?? null) : (showAll ? (summary ?? null) : null)}
            nodeColors={nodeColors}
            loading={selectedPolicy ? policyLoading : (showAll ? summaryLoading : false)}
            error={errorMessage}
            onExpandNode={onExpandNode}
            emptyPrompt="Search for a policy above to see the secret paths it grants access to."
          />
        </>
      )}
      {view === 'table' && graphData && selectedPolicy && (
        <GraphTableView data={graphData} diagramType="policy-secret" />
      )}
      {view === 'table' && (!graphData || !selectedPolicy) && (
        <GraphWrapper loading={false} error={errorMessage}>
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Search for a policy above to see its table view.
          </div>
        </GraphWrapper>
      )}
    </div>
  );
}
