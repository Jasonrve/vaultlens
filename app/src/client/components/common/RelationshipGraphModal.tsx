/**
 * RelationshipGraphModal — opens from Entity, Group, or Auth Method detail pages.
 * Displays a focused relationship graph with the current item as the root node.
 */
import { useEffect, useState, useCallback } from 'react';
import * as api from '../../lib/api';
import type { GraphData } from '../../types';
import GraphExplorer from '../graphs/GraphExplorer';

type EntityType = 'entity' | 'group' | 'authMethod';

interface Props {
  entityType: EntityType;
  /** Vault UUID for entity/group, or mount path for authMethod */
  entityId: string;
  entityLabel: string;
  onClose: () => void;
}

/** Extract the subgraph reachable from rootNodeId (BFS) */
function extractSubgraph(data: GraphData, rootNodeId: string): GraphData {
  const childMap = new Map<string, string[]>();
  for (const edge of data.edges) {
    if (!childMap.has(edge.source)) childMap.set(edge.source, []);
    childMap.get(edge.source)!.push(edge.target);
  }
  const reachable = new Set<string>([rootNodeId]);
  const queue = [rootNodeId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const child of childMap.get(cur) ?? []) {
      if (!reachable.has(child)) {
        reachable.add(child);
        queue.push(child);
      }
    }
  }
  return {
    nodes: data.nodes.filter((n) => reachable.has(n.id)),
    edges: data.edges.filter((e) => reachable.has(e.source) && reachable.has(e.target)),
  };
}

const NODE_COLORS: Record<string, string> = {
  policy: '#10b981',
  secretPath: '#60A5FA',
  authMethod: '#7c3aed',
  role: '#f59e0b',
  entity: '#60A5FA',
  group: '#14b8a6',
  me: '#1563ff',
};

const TITLE_LABELS: Record<EntityType, string> = {
  entity: 'Entity Relationships',
  group: 'Group Relationships',
  authMethod: 'Auth Method Relationships',
};

export default function RelationshipGraphModal({ entityType, entityId, entityLabel, onClose }: Props) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (entityType === 'entity') {
        const data = await api.getUserIdentityMap({ entityId });
        setGraphData(data);
      } else if (entityType === 'group') {
        const data = await api.getUserIdentityMap({ groupId: entityId });
        setGraphData(data);
      } else if (entityType === 'authMethod') {
        // Fetch the full auth-policy map, then filter to the authMethod subtree
        const data = await api.getAuthPolicyMap();
        // Auth method node IDs are formatted as auth-<normalizedMountPath>
        const normalizedId = `auth-${entityId.replace(/\/$/, '')}`;
        const subgraph = extractSubgraph(data, normalizedId);
        setGraphData(subgraph.nodes.length > 0 ? subgraph : data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex h-[85vh] w-[90vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              {TITLE_LABELS[entityType]}
            </p>
            <h2 className="mt-0.5 text-base font-semibold text-gray-900">{entityLabel}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Graph */}
        <div className="min-h-0 flex-1 p-4">
          <GraphExplorer
            data={graphData}
            nodeColors={NODE_COLORS}
            loading={loading}
            error={error}
            hideSearch={true}
            autoExpandRoots={true}
          />
        </div>
      </div>
    </div>
  );
}
