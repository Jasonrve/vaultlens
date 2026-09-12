import AuditPagination from './AuditPagination';
import AuditDisclosureIcon from './AuditDisclosureIcon';
import { useState } from 'react';
import ObjectPath from './AuditObjectLink';
import type { PolicyUsage } from '../../shared/policyUsage';

export default function AuditPolicyAssignments({
  usage,
}: {
  usage: PolicyUsage;
}) {
  const [size, setSize] = useState(10);
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  const rows = usage.references.filter((reference) =>
    [
      reference.path,
      reference.kind,
      reference.relationship,
      reference.sourcePath,
    ].some((value) => value.toLowerCase().includes(query.toLowerCase())),
  );
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / size)));
  return (
    <details>
      <summary className="audit-disclosure-summary">
        <AuditDisclosureIcon level="detail" />
        <span>Policy assignments · {usage.references.length}</span>
      </summary>
      <p className="mt-2 text-xs text-gray-500">
        {usage.namespace || 'root'} · {usage.name}. Observed assignments and
        allowed policy references; existing tokens, allowed globs and collection
        gaps may not be covered.
      </p>
      {!usage.references.length ? (
        <p className="mt-2 text-sm">
          No assignments found in the available data. This does not prove the
          policy is unused.
        </p>
      ) : (
        <>
          <label className="mt-3 block text-xs">
            Filter assignments
            <input
              className="mt-1 block w-full rounded border p-2"
              value={query}
              placeholder="Object path, relationship or source"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Relationship
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Object type
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Namespace
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Object path
                  </th>
                  {usage.references.some(
                    (reference) => reference.relationship === 'inherited',
                  ) && (
                    <th scope="col" className="px-3 py-2">
                      Inherited from
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice((current - 1) * size, current * size)
                  .map((reference, index) => (
                    <tr key={index} className="border-t align-top">
                      <td className="px-3 py-2">
                        {
                          {
                            assigned: 'Direct assignment',
                            inherited: 'Inherited',
                            allowed: 'Allowed for issuance',
                          }[reference.relationship]
                        }
                      </td>
                      <td className="px-3 py-2">
                        {(
                          {
                            role: 'Auth role',
                            entity: 'Entity',
                            group: 'Group',
                          } as Record<string, string>
                        )[reference.kind] ?? reference.kind}
                      </td>
                      <td className="px-3 py-2">{usage.namespace || 'root'}</td>
                      <td className="px-3 py-2">
                        <ObjectPath
                          path={reference.path}
                          namespace={usage.namespace}
                        />
                      </td>
                      {usage.references.some(
                        (item) => item.relationship === 'inherited',
                      ) && (
                        <td className="px-3 py-2">
                          {reference.relationship === 'inherited' ? (
                            <ObjectPath
                              path={reference.sourcePath}
                              namespace={usage.namespace}
                            />
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Links open the current Vault object in a new tab, not its historical
            state.
            {usage.namespace
              ? ' Direct links are unavailable for this namespace.'
              : ''}
          </p>
          {!rows.length && (
            <p className="mt-2 text-xs">No matching assignments.</p>
          )}
          <AuditPagination
            page={current}
            total={rows.length}
            size={size}
            onChange={setPage}
            onSizeChange={setSize}
          />
        </>
      )}
    </details>
  );
}
