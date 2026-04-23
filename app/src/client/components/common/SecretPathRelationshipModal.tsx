/**
 * SecretPathRelationshipModal — shows a relationship graph for a given secret
 * path, visualising which policies cover it and, through those policies, which
 * groups/entities or auth-method roles have access.
 *
 * Graph structure:
 *   secretPath → policy → group → entity
 *                       → auth role → auth method
 */
import { useEffect, useState, useCallback } from 'react';
import * as api from '../../lib/api';
import type { GraphData } from '../../types';
import GraphExplorer from '../graphs/GraphExplorer';

interface Props {
  /** Full Vault-style path being viewed, e.g. "kv/data/myapp/db" */
  path: string;
  onClose: () => void;
}

const NODE_COLORS: Record<string, string> = {
  secretPath: '#1563ff',
  policy:     '#10b981',
  group:      '#14b8a6',
  entity:     '#60A5FA',
  role:       '#f59e0b',
  authMethod: '#7c3aed',
};

export default function SecretPathRelationshipModal({ path, onClose }: Props) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSecretPathRelationships(path);
      setGraphData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load relationships');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const hasRelationships = graphData && graphData.nodes.length > 1;

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
              Secret Path Relationships
            </p>
            <h2 className="mt-0.5 font-mono text-sm font-semibold text-gray-900">{path}</h2>
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

        {/* Legend */}
        <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50 px-5 py-2 text-xs text-gray-500">
          {Object.entries(NODE_COLORS).map(([type, color]) => (
            <span key={type} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
              {type === 'secretPath' ? 'secret path' : type}
            </span>
          ))}
        </div>

        {/* Graph */}
        <div className="min-h-0 flex-1 p-4">
          {!loading && !error && !hasRelationships && (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              No policies found that cover this path.
            </div>
          )}
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
