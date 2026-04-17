/**
 * Shared node types, interfaces, and helpers used across all graph components.
 */
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeTypes } from '@xyflow/react';

// ── Auth icon map ─────────────────────────────────────────────────────────────
export const AUTH_ICONS: Record<string, string> = {
  token: '🔑', oidc: '🔐', github: '🐙', kubernetes: '☸️',
  approle: '🤖', ldap: '📂', aws: '☁️', gcp: '🌐', azure: '🔷',
  jwt: '🪙', okta: '🛡️', radius: '📡', cert: '📜',
};

/** Small emoji icon for auth-backend nodes */
export function AuthIcon({ type }: { type?: string }) {
  const icon = type ? (AUTH_ICONS[type.toLowerCase()] ?? '🔒') : '🔒';
  return (
    <span
      className="ml-1 shrink-0 text-[11px] leading-none"
      title={`Auth backend: ${type ?? 'auth'}`}
      aria-label={`Auth backend: ${type ?? 'auth'}`}
    >
      {icon}
    </span>
  );
}

// ── Expandable node data ──────────────────────────────────────────────────────
export interface ExpandableNodeData {
  label: string;
  color: string;
  hasChildren: boolean;
  isExpanded: boolean;
  isHighlighted: boolean;
  isAuthPath?: boolean;
  authType?: string;
  [key: string]: unknown;
}

/** Custom ReactFlow node that renders a coloured pill with expand/collapse indicator */
export const ExpandableNode = memo(function ExpandableNode({
  data,
}: {
  data: ExpandableNodeData;
}) {
  // Auth-path nodes get a vivid violet override regardless of nodeColors
  const bg = data.isAuthPath ? '#7c3aed' : (data.color || '#6b7280');
  return (
    <div
      title={data.label}
      style={{
        background: bg,
        boxShadow: data.isHighlighted
          ? '0 0 0 3px #fbbf24, 0 0 12px rgba(251,191,36,0.5)'
          : '0 1px 3px rgba(0,0,0,0.18)',
      }}
      className="relative flex min-w-[100px] max-w-[180px] items-center rounded-md px-3 py-1.5 text-xs font-medium text-white select-none"
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span className="max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap">{data.label}</span>
      {data.hasChildren && (
        <span
          className="ml-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/25 text-[10px] font-bold leading-none text-white"
          title={data.isExpanded ? 'Collapse' : 'Expand'}
        >
          {data.isExpanded ? '−' : '+'}
        </span>
      )}
      {data.isAuthPath && <AuthIcon type={data.authType as string | undefined} />}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
});

/** Stable reference so ReactFlow does not re-register node types on every render */
export const NODE_TYPES: NodeTypes = {
  expandable: ExpandableNode as unknown as NodeTypes['expandable'],
};

// ── Quick-view panel types ─────────────────────────────────────────────────────
export interface QuickViewNode {
  id: string;
  label: string;
  nodeType: string;
  capabilities?: string[];
  isAuthPath?: boolean;
  authType?: string;
}

/** Returns Tailwind classes for a capability badge */
export function capBadgeClass(cap: string): string {
  if (cap === 'deny') return 'bg-red-100 text-red-700';
  if (cap === 'sudo') return 'bg-orange-100 text-orange-700';
  if (cap === 'read' || cap === 'list') return 'bg-green-100 text-green-700';
  if (cap === 'delete') return 'bg-red-50 text-red-600';
  return 'bg-blue-100 text-blue-700';
}

/** Standard node colours by Vault resource type */
export const NODE_COLORS: Record<string, string> = {
  policy: '#10b981',
  secretPath: '#60A5FA',
  authMethod: '#6366f1',
  role: '#f59e0b',
  entity: '#60A5FA',
  group: '#f59e0b',
  me: '#1563ff',
};
