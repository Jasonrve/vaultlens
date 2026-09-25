#!/usr/bin/env node
// ============================================================================
//  VaultLens — Bulk scale-testing seed script
// ============================================================================
// Injects a large, realistically-named set of policies, AppRole auth mounts
// (with roles), identity entities/groups, and nested KV v2 secrets into a
// local dev Vault, so /visualizations and /identity can be tested at scale.
//
// This is a standalone script (plain Node, global fetch, zero dependencies)
// run manually against an already-running local Vault — it is NOT wired into
// docker-compose-development.yml, so normal `docker compose up` stays fast.
//
// Usage:
//   VAULT_ADDR=http://localhost:8200 VAULT_TOKEN=root \
//     node vault/scripts/seed-scale.mjs [--flag=value ...]
//
// Reset: the dev Vault container has no storage volume, so
//   docker compose -f docker-compose-development.yml restart vault vault-init
// wipes everything back to the small baseline fixture from bootstrap.sh.
//
// Run with --help to see all flags and their defaults.
// ============================================================================

const DEFAULTS = {
  policies: 10000,
  'auth-mounts': 50,
  'roles-per-mount': 500,
  entities: 20000,
  groups: 2000,
  'kv-paths': 20000,
  'kv-depth': 4,
  concurrency: 30,
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') {
      args.help = true;
      continue;
    }
    const m = /^--([a-z-]+)=(.+)$/.exec(raw);
    if (!m) continue;
    const [, key, value] = m;
    if (!(key in DEFAULTS)) continue;
    args[key] = Number(value);
  }
  return args;
}

function printHelp() {
  console.log(`VaultLens — Bulk scale-testing seed script

Seeds a local dev Vault with a large amount of realistically-named policies,
AppRole auth mounts/roles, identity entities/groups, and nested KV v2 secrets,
so /visualizations and /identity can be tested against a non-trivial Vault
install. Total default work is roughly 77,000 write requests — this will run
for several minutes.

Env vars:
  VAULT_ADDR   Vault base URL (default: http://localhost:8200)
  VAULT_TOKEN  Vault token, needs broad write access (default: root)

Flags (all optional, defaults shown):
  --policies=${DEFAULTS.policies}
  --auth-mounts=${DEFAULTS['auth-mounts']}
  --roles-per-mount=${DEFAULTS['roles-per-mount']}
  --entities=${DEFAULTS.entities}
  --groups=${DEFAULTS.groups}
  --kv-paths=${DEFAULTS['kv-paths']}
  --kv-depth=${DEFAULTS['kv-depth']}
  --concurrency=${DEFAULTS.concurrency}

Example (small smoke test):
  node vault/scripts/seed-scale.mjs --policies=50 --auth-mounts=2 \\
    --roles-per-mount=10 --entities=100 --groups=10 --kv-paths=100
`);
}

// ── Bounded worker-pool concurrency (standalone copy — this script isn't
// part of the app/ TS build, so it doesn't import lib/concurrency.ts) ──────
async function concurrentMap(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// ── Name generation — realistic, clustered, searchable ─────────────────────
const TEAMS = ['billing', 'platform', 'identity', 'data', 'infra', 'growth', 'mobile', 'security', 'search', 'payments'];
const ENVS = ['prod', 'staging', 'dev', 'nprd', 'qa'];
const ROLE_WORDS = ['readonly', 'admin', 'deploy', 'service', 'operator', 'viewer'];

function pick(arr, seed) {
  return arr[seed % arr.length];
}

function realisticName(i) {
  // Deterministic-but-varied combination so names cluster meaningfully
  // (searching "billing" or "prod" hits a real subset, not 1 or all N).
  const team = pick(TEAMS, i);
  const env = pick(ENVS, Math.floor(i / TEAMS.length));
  const role = pick(ROLE_WORDS, Math.floor(i / (TEAMS.length * ENVS.length)));
  return `${team}-${env}-${role}-${String(i).padStart(4, '0')}`;
}

function randomSubset(arr, min, max) {
  const n = Math.min(arr.length, min + Math.floor(Math.random() * (max - min + 1)));
  const out = new Set();
  while (out.size < n) {
    out.add(arr[Math.floor(Math.random() * arr.length)]);
  }
  return [...out];
}

// ── Vault HTTP client ───────────────────────────────────────────────────────
class Counters {
  ok = 0;
  fail = 0;
}

function makeClient(vaultAddr, token) {
  return async function vaultRequest(method, path, body) {
    const res = await fetch(`${vaultAddr}/v1${path}`, {
      method,
      headers: {
        'X-Vault-Token': token,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    }
    if (res.status === 204 || res.status === 404) return null;
    return res.json().catch(() => null);
  };
}

function progress(label, done, total) {
  if (done % 500 === 0 || done === total) {
    console.log(`  ${label}: ${done}/${total}`);
  }
}

async function withCounters(counters, label, done, total, fn) {
  try {
    await fn();
    counters.ok += 1;
  } catch (e) {
    counters.fail += 1;
    if (counters.fail <= 10) {
      console.warn(`  ! ${label} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  progress(label, done, total);
}

// ── Seeding steps ────────────────────────────────────────────────────────────

async function seedKvPaths(vault, args, counters) {
  const mount = 'kv-scale';
  console.log(`\n→ Enabling KV v2 secrets engine at ${mount}/...`);
  await vault('POST', `/sys/mounts/${mount}`, { type: 'kv-v2' }).catch(() => {
    /* already enabled */
  });

  const count = args['kv-paths'];
  const depth = Math.max(1, args['kv-depth']);
  const paths = [];
  let done = 0;

  await concurrentMap(Array.from({ length: count }, (_, i) => i), args.concurrency, async (i) => {
    const segments = [];
    for (let d = 0; d < depth; d += 1) {
      segments.push(realisticName(i + d * 7919).split('-').slice(0, 2).join('-'));
    }
    segments.push(`secret-${String(i).padStart(5, '0')}`);
    const path = segments.join('/');
    // KV v2 data lives under <mount>/data/<path> — policies must match that,
    // not the logical <mount>/<path>, or granted capabilities point nowhere.
    paths.push(`${mount}/data/${path}`);

    done += 1;
    await withCounters(counters, 'kv-paths', done, count, () =>
      vault('POST', `/${mount}/data/${path}`, {
        data: { value: `seed-value-${i}`, created_by: 'seed-scale.mjs' },
      })
    );
  });

  return paths;
}

async function seedPolicies(vault, args, counters, kvPaths) {
  console.log(`\n→ Writing ${args.policies} policies...`);
  const names = [];
  let done = 0;

  await concurrentMap(Array.from({ length: args.policies }, (_, i) => i), args.concurrency, async (i) => {
    const name = `policy-${realisticName(i)}`;
    names.push(name);
    const grantPaths = kvPaths.length > 0 ? randomSubset(kvPaths, 1, 3) : [`kv-scale/data/placeholder-${i}`];
    const hcl = grantPaths
      .map((p) => `path "${p}" {\n  capabilities = ["read", "list"]\n}`)
      .join('\n\n');

    done += 1;
    await withCounters(counters, 'policies', done, args.policies, () =>
      vault('PUT', `/sys/policies/acl/${name}`, { policy: hcl })
    );
  });

  return names;
}

async function seedAuthMountsAndRoles(vault, args, counters, policyNames) {
  console.log(`\n→ Enabling ${args['auth-mounts']} AppRole auth mounts with ${args['roles-per-mount']} roles each...`);
  const mounts = Array.from({ length: args['auth-mounts'] }, (_, i) => `approle-${realisticName(i)}`);

  for (const mount of mounts) {
    await vault('POST', `/sys/auth/${mount}`, { type: 'approle' }).catch(() => {
      /* already enabled */
    });
  }

  const totalRoles = mounts.length * args['roles-per-mount'];
  let done = 0;

  for (const mount of mounts) {
    const roleIndices = Array.from({ length: args['roles-per-mount'] }, (_, i) => i);
    await concurrentMap(roleIndices, args.concurrency, async (i) => {
      const roleName = realisticName(i);
      const policies = policyNames.length > 0 ? randomSubset(policyNames, 1, 4) : [];

      done += 1;
      await withCounters(counters, 'auth-roles', done, totalRoles, () =>
        vault('POST', `/auth/${mount}/role/${roleName}`, {
          token_policies: policies,
          token_ttl: '1h',
          token_max_ttl: '4h',
        })
      );
    });
  }
}

async function seedEntities(vault, args, counters, policyNames) {
  console.log(`\n→ Creating ${args.entities} identity entities...`);
  const entityIds = [];
  let done = 0;

  await concurrentMap(Array.from({ length: args.entities }, (_, i) => i), args.concurrency, async (i) => {
    const name = `entity-${realisticName(i)}`;
    const policies = policyNames.length > 0 ? randomSubset(policyNames, 1, 3) : [];

    done += 1;
    await withCounters(counters, 'entities', done, args.entities, async () => {
      const resp = await vault('POST', '/identity/entity', { name, policies });
      const id = resp?.data?.id;
      if (id) entityIds.push(id);
    });
  });

  return entityIds;
}

async function seedGroups(vault, args, counters, policyNames, entityIds) {
  console.log(`\n→ Creating ${args.groups} identity groups...`);
  let done = 0;

  await concurrentMap(Array.from({ length: args.groups }, (_, i) => i), args.concurrency, async (i) => {
    const name = `group-${realisticName(i)}`;
    const policies = policyNames.length > 0 ? randomSubset(policyNames, 1, 3) : [];
    const members = entityIds.length > 0 ? randomSubset(entityIds, 0, Math.min(10, entityIds.length)) : [];

    done += 1;
    await withCounters(counters, 'groups', done, args.groups, () =>
      vault('POST', '/identity/group', { name, policies, member_entity_ids: members })
    );
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const vaultAddr = process.env.VAULT_ADDR || 'http://localhost:8200';
  const token = process.env.VAULT_TOKEN || 'root';
  const vault = makeClient(vaultAddr, token);

  console.log('============================================');
  console.log('  VaultLens — Bulk Scale Seed');
  console.log('============================================');
  console.log(`  Vault:       ${vaultAddr}`);
  console.log(`  Concurrency: ${args.concurrency}`);
  console.log(`  Policies:        ${args.policies}`);
  console.log(`  Auth mounts:     ${args['auth-mounts']} x ${args['roles-per-mount']} roles`);
  console.log(`  Entities/Groups: ${args.entities} / ${args.groups}`);
  console.log(`  KV paths:        ${args['kv-paths']} (depth ${args['kv-depth']})`);

  try {
    await vault('GET', '/sys/health');
  } catch (e) {
    console.error(`\nCould not reach Vault at ${vaultAddr}: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
    return;
  }

  const counters = new Counters();
  const startedAt = Date.now();

  const kvPaths = await seedKvPaths(vault, args, counters);
  const policyNames = await seedPolicies(vault, args, counters, kvPaths);
  await seedAuthMountsAndRoles(vault, args, counters, policyNames);
  const entityIds = await seedEntities(vault, args, counters, policyNames);
  await seedGroups(vault, args, counters, policyNames, entityIds);

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n============================================');
  console.log(`  Done in ${elapsedSec}s — ${counters.ok} succeeded, ${counters.fail} failed`);
  console.log('============================================');
}

main();
