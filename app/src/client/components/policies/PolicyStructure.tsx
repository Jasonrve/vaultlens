import Badge from '../common/Badge';

interface PolicyStructureProps {
  paths: Array<{ path: string; capabilities: string[] }>;
}

export default function PolicyStructure({ paths }: PolicyStructureProps) {
  return (
    <div className="rounded-md border border-gray-200">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600">
        Policy Structure
      </div>
      <div className="divide-y divide-gray-100">
        {paths.map((p) => (
          <div key={p.path} className="px-4 py-3">
            <div className="mb-1 font-mono text-sm font-medium text-gray-700">{p.path}</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {p.capabilities.map((cap) => (
                <Badge key={cap} text={cap} />
              ))}
            </div>
            <div className="rounded bg-gray-50 p-2 font-mono text-xs text-gray-500">
              {'{ "key": "********" }'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
