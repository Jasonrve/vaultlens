/**
 * Cache for Vault resource bodies (policy HCL, role config, entity/group
 * records, and small reverse-lookup scans) keyed by resource identity — not
 * by caller token, unlike the per-token graph cache in routes/graph.ts.
 *
 * Safe to share across callers: the LIST call that determines which
 * resources a caller may even enumerate still runs with their own token on
 * every request (ACL enforcement is unchanged); this cache only avoids
 * re-fetching the *body* of a resource a caller has already been shown in
 * their own LIST result, and Vault returns identical content for a given
 * resource to any caller authorized to read it. This is what turns
 * "N concurrent users x M resources" detail reads into roughly "M resources
 * per TTL window" regardless of how many people are viewing a page.
 *
 * ponytail: assumes list-capability implies read-capability for a given
 * resource path, which is the common Vault ACL authoring pattern (e.g.
 * `path "sys/policies/acl/*" { capabilities = ["list","read"] }`). If a
 * deployment splits list/read capabilities on these paths, a caller who can
 * list but not read a specific resource could see another caller's
 * already-cached copy of it. Ceiling: acceptable given the short TTL and
 * that this mirrors the existing per-token graph cache's trust model; a
 * stricter fix would mean reimplementing Vault's ACL evaluation here.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export interface GetOrFetchOptions {
  ttlMs?: number;
  /** Skip reading the cache (still writes the fresh result back). */
  bypassCache?: boolean;
}

export async function getOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: GetOrFetchOptions = {},
): Promise<T> {
  const { ttlMs = DEFAULT_TTL_MS, bypassCache = false } = opts;

  if (!bypassCache) {
    const entry = cache.get(key) as CacheEntry<T> | undefined;
    if (entry && Date.now() - entry.cachedAt <= ttlMs) {
      return entry.value;
    }
  }

  const value = await fetcher();
  cache.set(key, { value, cachedAt: Date.now() });
  return value;
}

export function invalidateResourceCache(key: string): void {
  cache.delete(key);
}
