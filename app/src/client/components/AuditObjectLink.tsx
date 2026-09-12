import { Link } from 'react-router-dom';

function objectLink(path: string, namespace: string): string | undefined {
  // Existing object screens do not accept an audit namespace parameter.
  if (namespace) return undefined;
  const policy = path.match(/^sys\/policies\/acl\/(.+)$/);
  if (policy) return `/policies/${encodeURIComponent(policy[1])}?readonly=1`;
  const role = path.match(/^auth\/(.+)\/roles?\/([^/]+)$/);
  if (role)
    return `/access/auth-methods/${encodeURIComponent(role[1])}/roles/${encodeURIComponent(role[2])}`;
  const identity = path.match(/^identity\/(entity|group)\/id\/([^/]+)$/);
  if (identity)
    return `/access/${identity[1] === 'entity' ? 'entities' : 'groups'}/${encodeURIComponent(identity[2])}`;
}
export default function AuditObjectLink({
  path,
  namespace,
}: {
  path: string;
  namespace: string;
}) {
  const href = objectLink(path, namespace);
  return href ? (
    <Link
      to={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all font-mono text-xs text-blue-700 underline"
      aria-label={`Open live object ${path} in a new tab`}
    >
      {path}
    </Link>
  ) : (
    <span className="break-all font-mono text-xs">{path}</span>
  );
}
