import { useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as api from '../../lib/api';
import type { GraphData } from '../../types';
import GraphWrapper from './GraphWrapper';
import GraphTableView from './GraphTableView';

const nodeColors: Record<string, string> = {
  authMethod: '#6366f1',
  role: '#f59e0b',
  policy: '#10b981',
};

export default function AuthPolicyGraph() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'graph' | 'table'>('graph');

  useEffect(() => {
    api
      .getAuthPolicyMap()
      .then(setGraphData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  }, []);

  const nodes: Node[] = (graphData?.nodes ?? []).map((n) => ({
    id: n.id,
    position: n.position,
    data: { label: n.data.label },
    style: {
      background: nodeColors[n.type] ?? '#94a3b8',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      padding: '8px 14px',
      fontSize: '12px',
      fontWeight: 600,
      minWidth: '140px',
      maxWidth: '220px',
      textAlign: 'center' as const,
      whiteSpace: 'pre-wrap' as const,
      wordBreak: 'break-word' as const,
    },
  }));

  const edges: Edge[] = (graphData?.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: true,
    style: { stroke: '#94a3b8' },
  }));

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
          <GraphWrapper loading={loading} error={error}>
            <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.15 }} proOptions={{ hideAttribution: true }}>
              <Background color="#e5e7eb" gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </GraphWrapper>
        </>
      )}
      {view === 'table' && graphData && (
        <GraphTableView data={graphData} diagramType="auth-policy" />
      )}
      {view === 'table' && !graphData && !loading && (
        <GraphWrapper loading={loading} error={error}>{<></>}</GraphWrapper>
      )}
    </div>
  );
}

