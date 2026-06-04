/**
 * Unified Vault ACL Policy Evaluator
 *
 * Faithfully implements HashiCorp Vault's ACL evaluation semantics:
 * - Three-tier path resolution: exact → prefix → segment wildcard
 * - Deny-wins capability merging across policies
 * - 5-rule priority sort for segment wildcard paths
 *
 * Shared by both the server (permission tester) and client (policy tester panel).
 *
 * Reference: https://github.com/hashicorp/vault/blob/main/vault/acl.go
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface PolicyRule {
  path: string;
  capabilities: string[];
}

export interface ParsedRule {
  /** Original path from the policy */
  originalPath: string;
  /** Processed path (trailing * stripped for prefix rules) */
  path: string;
  capabilities: string[];
  capabilityBitmap: number;
  isPrefix: boolean;
  hasSegmentWildcards: boolean;
}

export interface ParsedPolicy {
  name?: string;
  rules: ParsedRule[];
}

export interface ACLStore {
  /** Exact path → merged capability bitmap */
  exactRules: Map<string, ACLPermissions>;
  /** Prefix path (trailing * stripped) → merged capability bitmap */
  prefixRules: Map<string, ACLPermissions>;
  /** Segment wildcard path → merged capability bitmap */
  segmentWildcardPaths: Map<string, ACLPermissions>;
}

export interface ACLPermissions {
  capabilityBitmap: number;
  /** The original capabilities as strings, for display */
  capabilities: string[];
  /** Which rules contributed to this permission set */
  grantingPaths: string[];
}

export interface EvaluationResult {
  allowed: boolean;
  denied: boolean;
  matchedPath: string | null;
  matchedCapabilities: string[];
  reason: string;
  /** All capabilities available at the matched path */
  effectiveCapabilities: string[];
}

// ── Capability bitmap constants (matching Vault's acl.go) ────────────────────

export const DenyCapabilityInt = 1 << 0;
export const CreateCapabilityInt = 1 << 1;
export const ReadCapabilityInt = 1 << 2;
export const UpdateCapabilityInt = 1 << 3;
export const DeleteCapabilityInt = 1 << 4;
export const ListCapabilityInt = 1 << 5;
export const SudoCapabilityInt = 1 << 6;
export const PatchCapabilityInt = 1 << 7;

const CAPABILITY_MAP: Record<string, number> = {
  deny: DenyCapabilityInt,
  create: CreateCapabilityInt,
  read: ReadCapabilityInt,
  update: UpdateCapabilityInt,
  delete: DeleteCapabilityInt,
  list: ListCapabilityInt,
  sudo: SudoCapabilityInt,
  patch: PatchCapabilityInt,
};

const OPERATION_TO_CAPABILITY: Record<string, number> = {
  create: CreateCapabilityInt,
  read: ReadCapabilityInt,
  update: UpdateCapabilityInt,
  delete: DeleteCapabilityInt,
  list: ListCapabilityInt,
  sudo: SudoCapabilityInt,
  patch: PatchCapabilityInt,
};

// ── HCL Parsing ──────────────────────────────────────────────────────────────

/**
 * Parse an HCL policy string into structured rules.
 * Extracts `path "..." { capabilities = [...] }` blocks.
 */
export function parsePolicyHCL(hcl: string): PolicyRule[] {
  const paths: PolicyRule[] = [];

  const pathStartRegex = /path\s+"([^"\\]*(?:\\.[^"\\]*)*)"\s*\{/g;
  let startMatch: RegExpExecArray | null;

  while ((startMatch = pathStartRegex.exec(hcl)) !== null) {
    const pathValue = startMatch[1];
    if (!pathValue) continue;

    // Find matching closing brace, accounting for nested braces
    let braceDepth = 1;
    let pos = pathStartRegex.lastIndex;
    while (pos < hcl.length && braceDepth > 0) {
      if (hcl[pos] === '{') braceDepth++;
      else if (hcl[pos] === '}') braceDepth--;
      pos++;
    }

    const blockContent = hcl.slice(pathStartRegex.lastIndex, pos - 1);

    const capRegex = /capabilities\s*=\s*\[([^\]]*)\]/;
    const capMatch = capRegex.exec(blockContent);

    if (capMatch?.[1]) {
      const capabilities = capMatch[1]
        .split(',')
        .map((c) => c.trim().replace(/"/g, ''))
        .filter((c) => c.length > 0);

      paths.push({ path: pathValue, capabilities });
    }
  }

  return paths;
}

// ── Rule Classification (mirrors Vault's policy.go parsePaths) ───────────────

function capabilitiesToBitmap(capabilities: string[]): number {
  let bitmap = 0;
  for (const cap of capabilities) {
    const bit = CAPABILITY_MAP[cap.toLowerCase()];
    if (bit !== undefined) bitmap |= bit;
  }
  return bitmap;
}

function bitmapToCapabilities(bitmap: number): string[] {
  const caps: string[] = [];
  if (bitmap & DenyCapabilityInt) caps.push('deny');
  if (bitmap & CreateCapabilityInt) caps.push('create');
  if (bitmap & ReadCapabilityInt) caps.push('read');
  if (bitmap & UpdateCapabilityInt) caps.push('update');
  if (bitmap & DeleteCapabilityInt) caps.push('delete');
  if (bitmap & ListCapabilityInt) caps.push('list');
  if (bitmap & SudoCapabilityInt) caps.push('sudo');
  if (bitmap & PatchCapabilityInt) caps.push('patch');
  return caps;
}

/**
 * Classify a policy rule into exact, prefix, or segment wildcard.
 *
 * Vault's logic (policy.go parsePaths):
 *   - If path contains '+', mark HasSegmentWildcards
 *   - If path ends in '*' AND NOT HasSegmentWildcards: strip '*', set IsPrefix
 *   - If path ends in '*' AND HasSegmentWildcards: keep path as-is, remains segment wildcard
 *   - Otherwise: exact path
 */
export function classifyRule(rule: PolicyRule): ParsedRule {
  const hasSegmentWildcards = rule.path.includes('+');
  const bitmap = capabilitiesToBitmap(rule.capabilities);

  let path = rule.path;
  let isPrefix = false;

  if (path.endsWith('*') && !hasSegmentWildcards) {
    // Glob suffix without segment wildcards → prefix rule
    path = path.slice(0, -1); // Strip the trailing *
    isPrefix = true;
  } else if (path.endsWith('*') && hasSegmentWildcards) {
    // Has both + and trailing * → stays as segment wildcard path
    // The * is NOT stripped (matches Vault behavior)
    isPrefix = false;
  }

  return {
    originalPath: rule.path,
    path,
    capabilities: rule.capabilities,
    capabilityBitmap: bitmap,
    isPrefix,
    hasSegmentWildcards,
  };
}

// ── ACL Construction (mirrors Vault's acl.go NewACL) ─────────────────────────

function mergePermissions(
  existing: ACLPermissions,
  incoming: ParsedRule,
): ACLPermissions {
  // If existing is deny, don't add anything
  if (existing.capabilityBitmap & DenyCapabilityInt) {
    return existing;
  }

  // If incoming is deny, override everything with deny
  if (incoming.capabilityBitmap & DenyCapabilityInt) {
    return {
      capabilityBitmap: DenyCapabilityInt,
      capabilities: ['deny'],
      grantingPaths: [incoming.originalPath],
    };
  }

  // OR the capabilities together
  const merged = existing.capabilityBitmap | incoming.capabilityBitmap;
  return {
    capabilityBitmap: merged,
    capabilities: bitmapToCapabilities(merged),
    grantingPaths: [...existing.grantingPaths, incoming.originalPath],
  };
}

function newPermissions(rule: ParsedRule): ACLPermissions {
  return {
    capabilityBitmap: rule.capabilityBitmap,
    capabilities: [...rule.capabilities],
    grantingPaths: [rule.originalPath],
  };
}

/**
 * Build an ACL store from one or more parsed policies.
 * Merges capabilities across policies for the same path (OR'd, deny wins).
 */
export function buildACL(policies: ParsedPolicy[]): ACLStore {
  const acl: ACLStore = {
    exactRules: new Map(),
    prefixRules: new Map(),
    segmentWildcardPaths: new Map(),
  };

  for (const policy of policies) {
    for (const rule of policy.rules) {
      let store: Map<string, ACLPermissions>;

      if (rule.hasSegmentWildcards) {
        store = acl.segmentWildcardPaths;
      } else if (rule.isPrefix) {
        store = acl.prefixRules;
      } else {
        store = acl.exactRules;
      }

      const existing = store.get(rule.path);
      if (existing) {
        store.set(rule.path, mergePermissions(existing, rule));
      } else {
        store.set(rule.path, newPermissions(rule));
      }
    }
  }

  return acl;
}

/**
 * Build an ACL from a single set of parsed rules (convenience).
 */
export function buildACLFromRules(rules: PolicyRule[]): ACLStore {
  const parsed: ParsedPolicy = {
    rules: rules.map(classifyRule),
  };
  return buildACL([parsed]);
}

// ── Path Matching ────────────────────────────────────────────────────────────

/**
 * Find the longest matching prefix in the prefix rules map.
 * Equivalent to Vault's radix tree LongestPrefix.
 */
function longestPrefixMatch(
  prefixRules: Map<string, ACLPermissions>,
  path: string,
): [string, ACLPermissions] | null {
  let bestKey: string | null = null;
  let bestPerms: ACLPermissions | null = null;

  for (const [prefix, perms] of prefixRules) {
    if (path.startsWith(prefix) && (bestKey === null || prefix.length > bestKey.length)) {
      bestKey = prefix;
      bestPerms = perms;
    }
  }

  return bestKey !== null && bestPerms !== null ? [bestKey, bestPerms] : null;
}

/**
 * Check if a test path matches a segment wildcard pattern.
 *
 * Vault's matching (router.go pathMatchesWildcardPath):
 *   - '+' matches exactly one path segment (no slashes)
 *   - Trailing '*' (on patterns with +) matches any remaining segments
 *   - Without prefix flag, segment count must match exactly
 */
function matchesSegmentWildcard(
  testPath: string,
  pattern: string,
  isPrefix: boolean,
): boolean {
  // Determine if the pattern has a trailing * (glob) while also having +
  let patternForMatching = pattern;
  let hasTrailingGlob = false;
  if (patternForMatching.endsWith('*')) {
    hasTrailingGlob = true;
    patternForMatching = patternForMatching.slice(0, -1);
    // Remove trailing slash left after stripping *
    if (patternForMatching.endsWith('/')) {
      patternForMatching = patternForMatching.slice(0, -1);
    }
  }

  const testParts = testPath.split('/');
  const patternParts = patternForMatching.split('/');

  if (testParts.length < patternParts.length) {
    return false;
  }

  if (!isPrefix && !hasTrailingGlob && testParts.length !== patternParts.length) {
    return false;
  }

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp === '+') {
      // Matches exactly one segment — always passes
      continue;
    }
    // For prefix patterns, the last segment can be a prefix match
    if (isPrefix && i === patternParts.length - 1 && testParts[i].startsWith(pp)) {
      continue;
    }
    if (pp !== testParts[i]) {
      return false;
    }
  }

  return true;
}

// ── Segment Wildcard Priority (mirrors Vault's acl.go CheckAllowedFromNonExactPaths sort) ─

interface WildcardMatch {
  path: string;
  perms: ACLPermissions;
  firstWCOrGlob: number;
  wildcards: number;
  isPrefix: boolean;
}

/**
 * Priority comparator for segment wildcard matches.
 *
 * From Vault's acl.go CheckAllowedFromNonExactPaths:
 *   1. First wildcard/glob position — later = higher priority
 *   2. IsPrefix — non-prefix = higher priority (prefer exact segment match over prefix)
 *   3. Number of wildcard (+) segments — fewer = higher priority
 *   4. Path length — longer = higher priority
 *   5. Lexicographic — larger = higher priority
 *
 * Returns true if a < b (a is lower priority).
 */
function wildcardLessThan(a: WildcardMatch, b: WildcardMatch): boolean {
  // Rule 1: First wildcard position
  if (a.firstWCOrGlob < b.firstWCOrGlob) return true;
  if (a.firstWCOrGlob > b.firstWCOrGlob) return false;

  // Rule 2: IsPrefix (prefix = lower priority)
  if (a.isPrefix && !b.isPrefix) return true;
  if (!a.isPrefix && b.isPrefix) return false;

  // Rule 3: More wildcards = lower priority
  if (a.wildcards > b.wildcards) return true;
  if (a.wildcards < b.wildcards) return false;

  // Rule 4: Shorter path = lower priority
  if (a.path.length < b.path.length) return true;
  if (a.path.length > b.path.length) return false;

  // Rule 5: Lexicographically smaller = lower priority
  if (a.path < b.path) return true;
  if (a.path > b.path) return false;

  return false;
}

/**
 * Find the best matching segment wildcard path.
 * Also considers the longest prefix match if it exists (it competes with wildcards).
 */
function findBestNonExactMatch(
  acl: ACLStore,
  path: string,
): [string, ACLPermissions] | null {
  const candidates: WildcardMatch[] = [];

  // Include the longest prefix match as a candidate (it competes with wildcards)
  const prefixMatch = longestPrefixMatch(acl.prefixRules, path);
  if (prefixMatch) {
    if (acl.segmentWildcardPaths.size === 0) {
      // No segment wildcards — prefix match wins directly
      return prefixMatch;
    }
    candidates.push({
      path: prefixMatch[0],
      perms: prefixMatch[1],
      firstWCOrGlob: prefixMatch[0].length, // First "wildcard" is at end of prefix
      wildcards: 0,
      isPrefix: true,
    });
  }

  // Check each segment wildcard path
  const pathParts = path.split('/');

  for (const [wcPath, perms] of acl.segmentWildcardPaths) {
    if (!wcPath) continue;

    let currWCPath = wcPath;
    let isPrefix = false;
    if (currWCPath.endsWith('*')) {
      isPrefix = true;
      currWCPath = currWCPath.slice(0, -1);
    }

    if (!matchesSegmentWildcard(path, wcPath, isPrefix)) {
      continue;
    }

    // Count wildcards and find first wildcard position
    const firstWCOrGlob = wcPath.indexOf('+');
    let wildcards = 0;
    for (const ch of wcPath) {
      if (ch === '+') wildcards++;
    }

    candidates.push({
      path: wcPath,
      perms,
      firstWCOrGlob: firstWCOrGlob === -1 ? pathParts.length : firstWCOrGlob,
      wildcards,
      isPrefix,
    });
  }

  if (candidates.length === 0) return null;

  // Sort by priority (ascending) and pick the last (highest priority)
  candidates.sort((a, b) => {
    if (wildcardLessThan(a, b)) return -1;
    if (wildcardLessThan(b, a)) return 1;
    return 0;
  });

  const winner = candidates[candidates.length - 1];
  return [winner.path, winner.perms];
}

// ── Main Evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluate whether an operation is allowed on a path given an ACL.
 *
 * Resolution order (mirrors Vault's AllowOperation in acl.go):
 *   1. Exact match in exactRules
 *   2. For list operations: also try path without trailing /
 *   3. Longest prefix match in prefixRules
 *   4. Segment wildcard matching with priority sort
 *   5. No match → denied by default
 */
export function evaluateAccess(
  acl: ACLStore,
  testPath: string,
  operation: string,
): EvaluationResult {
  // Normalize path
  let path = testPath.replace(/^\/+/, '');

  // Step 1: Exact match
  let perms = acl.exactRules.get(path);
  let matchedPath: string | null = null;

  if (perms) {
    matchedPath = path;
  }

  // Step 2: For list operations, also try without trailing /
  if (!perms && operation === 'list') {
    const trimmed = path.replace(/\/+$/, '');
    if (trimmed !== path) {
      perms = acl.exactRules.get(trimmed);
      if (perms) matchedPath = trimmed;
    }
  }

  // Step 3-4: Non-exact matches (prefix + segment wildcard)
  if (!perms) {
    // For list operations, also try without trailing / for non-exact
    if (operation === 'list' && path.endsWith('/')) {
      const result = findBestNonExactMatch(acl, path.replace(/\/+$/, ''));
      if (result) {
        [matchedPath, perms] = result;
      }
    }
    if (!perms) {
      const result = findBestNonExactMatch(acl, path);
      if (result) {
        [matchedPath, perms] = result;
      }
    }
  }

  // No match → denied by default
  if (!perms || matchedPath === null) {
    return {
      allowed: false,
      denied: false,
      matchedPath: null,
      matchedCapabilities: [],
      reason: 'No matching rule — access is denied by default',
      effectiveCapabilities: [],
    };
  }

  const effectiveCapabilities = bitmapToCapabilities(perms.capabilityBitmap);

  // Check deny
  if (perms.capabilityBitmap & DenyCapabilityInt) {
    return {
      allowed: false,
      denied: true,
      matchedPath,
      matchedCapabilities: ['deny'],
      reason: 'Rule explicitly denies access',
      effectiveCapabilities: ['deny'],
    };
  }

  // Check if the operation is allowed
  const opBit = OPERATION_TO_CAPABILITY[operation.toLowerCase()];
  if (!opBit) {
    return {
      allowed: false,
      denied: false,
      matchedPath,
      matchedCapabilities: effectiveCapabilities,
      reason: `Unknown operation "${operation}"`,
      effectiveCapabilities,
    };
  }

  const allowed = (perms.capabilityBitmap & opBit) !== 0;

  return {
    allowed,
    denied: false,
    matchedPath,
    matchedCapabilities: effectiveCapabilities,
    reason: allowed
      ? `Capability "${operation}" is granted by the matched rule`
      : `Capability "${operation}" is not in the matched rule's capabilities`,
    effectiveCapabilities,
  };
}

// ── Convenience: evaluate a single policy's rules ────────────────────────────

/**
 * Evaluate whether an operation is allowed on a path given a single policy's rules.
 * Used by the PolicyTesterPanel for per-policy testing.
 */
export function evaluateSinglePolicy(
  rules: PolicyRule[],
  testPath: string,
  operation: string,
): EvaluationResult {
  const acl = buildACLFromRules(rules);
  return evaluateAccess(acl, testPath, operation);
}

// ── Convenience: check if a path matches any rule in a set ───────────────────

/**
 * Check if a test path matches a policy path pattern.
 * Used for graph building where we need to know which rules are relevant.
 */
export function pathMatchesRule(testPath: string, rule: ParsedRule): boolean {
  const tp = testPath.replace(/^\/+/, '');

  if (rule.hasSegmentWildcards) {
    const isPrefix = rule.originalPath.endsWith('*');
    return matchesSegmentWildcard(tp, rule.originalPath, isPrefix);
  }

  if (rule.isPrefix) {
    return tp.startsWith(rule.path);
  }

  return tp === rule.path;
}

/**
 * Check if a test path matches a raw policy path string.
 */
export function pathMatchesPolicyPath(testPath: string, policyPath: string): boolean {
  const rule = classifyRule({ path: policyPath, capabilities: [] });
  return pathMatchesRule(testPath, rule);
}

/**
 * Given a set of matching rules, determine if the operation has the capability.
 * Used for graph node status in the permission tester.
 */
export function operationHasCapability(
  capabilities: string[],
  operation: string,
): boolean {
  const bitmap = capabilitiesToBitmap(capabilities);
  if (bitmap & DenyCapabilityInt) return false;
  const opBit = OPERATION_TO_CAPABILITY[operation.toLowerCase()];
  if (!opBit) return false;
  return (bitmap & opBit) !== 0;
}
