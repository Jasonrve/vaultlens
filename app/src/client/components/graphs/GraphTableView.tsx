import type { GraphData } from '../../types';

interface Column {
  key: string;
  label: string;
}

interface Row {
  [key: string]: string;
}

function buildAuthPolicyRows(data: GraphData): { columns: Column[]; rows: Row[] } {
  const columns: Column[] = [
    { key: 'authMethod', label: 'Auth Method' },
    { key: 'role', label: 'Role' },
    { key: 'policy', label: 'Policy' },
  ];

  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
  const rows: Row[] = [];

  // Build adjacency: source → targets
  const children = new Map<string, string[]>();
  for (const edge of data.edges) {
    if (!children.has(edge.source)) children.set(edge.source, []);
    children.get(edge.source)!.push(edge.target);
  }

  const authNodes = data.nodes.filter((n) => n.type === 'authMethod');

  for (const auth of authNodes) {
    const roles = (children.get(auth.id) ?? []).map((id) => nodeById.get(id)).filter(Boolean);

    if (roles.length === 0) {
      rows.push({ authMethod: auth.data.label, role: '—', policy: '—' });
      continue;
    }

    for (const role of roles) {
      const policies = (children.get(role!.id) ?? []).map((id) => nodeById.get(id)).filter(Boolean);

      if (policies.length === 0) {
        rows.push({ authMethod: auth.data.label, role: role!.data.label, policy: '—' });
        continue;
      }

      for (const policy of policies) {
        rows.push({
          authMethod: auth.data.label,
          role: role!.data.label,
          policy: policy!.data.label,
        });
      }
    }
  }

  return { columns, rows };
}

function buildPolicySecretRows(data: GraphData): { columns: Column[]; rows: Row[] } {
  const columns: Column[] = [
    { key: 'policy', label: 'Policy' },
    { key: 'secretPath', label: 'Secret Path' },
    { key: 'capabilities', label: 'Capabilities' },
  ];

  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
  const rows: Row[] = [];

  const children = new Map<string, string[]>();
  for (const edge of data.edges) {
    if (!children.has(edge.source)) children.set(edge.source, []);
    children.get(edge.source)!.push(edge.target);
  }

  const policyNodes = data.nodes.filter((n) => n.type === 'policy');

  for (const policy of policyNodes) {
    const paths = (children.get(policy.id) ?? []).map((id) => nodeById.get(id)).filter(Boolean);

    if (paths.length === 0) {
      rows.push({ policy: policy.data.label, secretPath: '—', capabilities: '—' });
      continue;
    }

    for (const path of paths) {
      const caps = Array.isArray(path!.data.capabilities)
        ? (path!.data.capabilities as string[]).join(', ')
        : '—';
      rows.push({
        policy: policy.data.label,
        secretPath: path!.data.label,
        capabilities: caps,
      });
    }
  }

  return { columns, rows };
}

function buildIdentityRows(data: GraphData): { columns: Column[]; rows: Row[] } {
  const columns: Column[] = [
    { key: 'entity', label: 'Entity' },
    { key: 'group', label: 'Group' },
    { key: 'policy', label: 'Policy' },
  ];

  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
  const rows: Row[] = [];

  const children = new Map<string, string[]>();
  for (const edge of data.edges) {
    if (!children.has(edge.source)) children.set(edge.source, []);
    children.get(edge.source)!.push(edge.target);
  }

  const entityNodes = data.nodes.filter((n) => n.type === 'entity');

  for (const entity of entityNodes) {
    const directChildren = (children.get(entity.id) ?? []).map((id) => nodeById.get(id)).filter(Boolean);

    const groups = directChildren.filter((n) => n!.type === 'group');
    const directPolicies = directChildren.filter((n) => n!.type === 'policy');

    // Direct entity → policy rows
    for (const policy of directPolicies) {
      rows.push({ entity: entity.data.label, group: '—', policy: policy!.data.label });
    }

    // Entity → group → policy rows
    for (const group of groups) {
      const groupPolicies = (children.get(group!.id) ?? []).map((id) => nodeById.get(id)).filter(
        (n) => n?.type === 'policy'
      );

      if (groupPolicies.length === 0) {
        rows.push({ entity: entity.data.label, group: group!.data.label, policy: '—' });
      } else {
        for (const policy of groupPolicies) {
          rows.push({
            entity: entity.data.label,
            group: group!.data.label,
            policy: policy!.data.label,
          });
        }
      }
    }

    if (groups.length === 0 && directPolicies.length === 0) {
      rows.push({ entity: entity.data.label, group: '—', policy: '—' });
    }
  }

  return { columns, rows };
}

type DiagramType = 'auth-policy' | 'policy-secret' | 'identity';

interface GraphTableViewProps {
  data: GraphData;
  diagramType: DiagramType;
}

export default function GraphTableView({ data, diagramType }: GraphTableViewProps) {
  const { columns, rows } =
    diagramType === 'auth-policy'
      ? buildAuthPolicyRows(data)
      : diagramType === 'policy-secret'
        ? buildPolicySecretRows(data)
        : buildIdentityRows(data);

  if (rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-gray-200 bg-white text-sm text-gray-400">
        No relationships to display
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-2 font-mono text-xs text-gray-700">
                  {row[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
