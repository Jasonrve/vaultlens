export interface AttributableAuditEntry {
  mountPoint: string;
  path: string;
  requestData: Record<string, unknown> | null;
}

/**
 * Determines whether an audit entry belongs to the given auth method mount,
 * and if so, which role (if any) it can be attributed to.
 *
 * ponytail: heuristic only — matches "role/<name>" in the path (role admin
 * operations) or a `role` field in the request body (e.g. login attempts).
 * The request-body match only works if the mount has been tuned with
 * `vault auth tune -audit-non-hmac-request-keys=role <mount>/` — otherwise
 * Vault HMACs the role name and it shows up as an opaque hash instead.
 * Errors with no role reference (e.g. a malformed JWT before Vault can even
 * pick a role) return role: null. Upgrade path: attribute via a resolved
 * role field from Vault itself, once audit entries expose one.
 */
export function attributeAuditError(
  mountPath: string,
  entry: AttributableAuditEntry,
): { inMount: boolean; role: string | null } {
  const cleanMountPoint = `auth/${mountPath.replace(/\/$/, '')}`;
  if (entry.mountPoint.replace(/\/$/, '') !== cleanMountPoint) {
    return { inMount: false, role: null };
  }

  let role: string | null = null;
  if (entry.path.startsWith(`${cleanMountPoint}/`)) {
    const subPath = entry.path.slice(cleanMountPoint.length + 1);
    const roleMatch = /^role\/([^/]+)/.exec(subPath);
    if (roleMatch) {
      role = roleMatch[1];
    } else {
      const bodyRole = entry.requestData?.['role'];
      // Vault HMACs the role field unless the mount is tuned to exempt it —
      // an HMAC'd value is useless as a role name, so treat it as unknown.
      if (typeof bodyRole === 'string' && !bodyRole.startsWith('hmac-sha256:')) {
        role = bodyRole;
      }
    }
  }
  return { inMount: true, role };
}
