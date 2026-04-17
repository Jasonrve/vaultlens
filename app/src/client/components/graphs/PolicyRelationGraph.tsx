import { useEffect, useState } from 'react';
import * as api from '../../lib/api';
import type { GraphData } from '../../types';
import GraphWrapper from './GraphWrapper';
import GraphTableView from './GraphTableView';
import GraphExplorer from './GraphExplorer';

const nodeColors: Record<string, string> = {
  policy: '#10b981',
  secretPath: '#60A5FA',
  group: '#f59e0b',
  role: '#f59e0b',
  authMethod: '#7c3aed',
};

const legendItems = [
  { label: 'policy', color: '#10b981' },
  { label: 'secret path', color: '#60A5FA' },
  { label: 'auth backend path', color: '#7c3aed', emoji: '🔒' },
  { label: 'group', color: '#f59e0b' },
  { label: 'role / auth method', color: '#7c3aed' },
];

interface Props {
  refreshKey?: number;
  onDataLoaded?: (cachedAt: number | undefined, fromCache: boolean) => void;
}

export default function PolicyRelationGraph({ refreshKey = 0, onDataLoaded }: Props) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'graph' | 'table'>('graph');

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getPolicyRelationshipsMap(refreshKey > 0)
      .then((data) => {
        setGraphData(data);
        onDataLoaded?.(data.cachedAt, data.fromCache ?? false);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-700">Policy Relationships</h2>
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
      {view === 'graph' && (
        <>
          <div className="mb-3 flex flex-wrap gap-4 text-xs text-gray-500">
            {legendItems.map(({ label, color, emoji }) => (
              <span key={label} className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded" style={{ background: color }} />
                {label}{emoji ? ` ${emoji}` : ''}
              </span>
            ))}
          </div>
          <GraphExplorer
            data={graphData}
            nodeColors={nodeColors}
            loading={loading}
            error={error}
          />
        </>
      )}
      {view === 'table' && graphData && (
        <GraphTableView data={graphData} diagramType="policy-secret" />
      )}
      {view === 'table' && !graphData && !loading && (
        <GraphWrapper loading={loading} error={error}>{null}</GraphWrapper>
      )}
    </div>
  );
}
