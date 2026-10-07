import { COLLECTION_SOURCES } from './collectionStages.js';
import { normalizeNamespace } from './namespaces.js';
import { setTimeout as delay } from 'node:timers/promises';
import { VaultError } from '../lib/vaultClient.js';
export interface RequestPolicyOptions {
  retries: number;
  requestsPerSecond: number;
  retryBackoffMs: number;
}
export const DEFAULT_REQUEST_POLICY: RequestPolicyOptions = {
  retries: 3,
  requestsPerSecond: 10,
  retryBackoffMs: 500,
};
export function validateRequestPolicy(options: RequestPolicyOptions): void {
  if (
    !Number.isInteger(options.retries) ||
    options.retries < 0 ||
    options.retries > 10
  )
    throw new Error('retries must be an integer from 0 to 10');
  if (
    !Number.isFinite(options.requestsPerSecond) ||
    options.requestsPerSecond <= 0 ||
    options.requestsPerSecond > 1000
  )
    throw new Error(
      'requestsPerSecond must be greater than 0 and at most 1000',
    );
  if (
    !Number.isInteger(options.retryBackoffMs) ||
    options.retryBackoffMs < 0 ||
    options.retryBackoffMs > 10000
  )
    throw new Error('retryBackoffMs must be an integer from 0 to 10000');
}
export function createRequestPolicy(
  options: RequestPolicyOptions,
  clock:
    | { now: () => number; sleep: (ms: number) => Promise<void> }
    | undefined = undefined,
  signal?: AbortSignal,
) {
  const timing = clock ?? {
    now: () => performance.now(),
    sleep: (ms: number) => delay(ms, undefined, { signal }),
  };
  validateRequestPolicy(options);
  let next = 0;
  const metrics = { requests: 0, retries: 0, rateWaitMs: 0, retryWaitMs: 0 };
  let admission = Promise.resolve();
  function acquire(): Promise<void> {
    const turn = admission.then(async () => {
      signal?.throwIfAborted();
      const wait = Math.max(0, next - timing.now());
      if (wait) {
        metrics.rateWaitMs += wait;
        await timing.sleep(wait);
      }
      next = timing.now() + 1000 / options.requestsPerSecond;
    });
    admission = turn.catch(() => {});
    return turn;
  }
  async function request<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await acquire();
      signal?.throwIfAborted();
      metrics.requests++;
      try {
        return await operation();
      } catch (error) {
        signal?.throwIfAborted();
        const retryable =
          error instanceof VaultError &&
          [408, 429, 500, 502, 503, 504].includes(error.statusCode);
        if (!retryable || attempt >= options.retries) throw error;
        metrics.retries++;
        const backoff = Math.min(10000, options.retryBackoffMs * 2 ** attempt);
        metrics.retryWaitMs += backoff;
        if (backoff) await timing.sleep(backoff);
      }
    }
  }
  return { request, metrics };
}

export interface CollectionOptions extends RequestPolicyOptions {
  sources: string[];
  namespace: string;
  redactPolicySource: boolean;
  recursiveNamespaces: boolean;
  workers: number;
  timeoutMs: number;
  maxDurationMs: number;
  maxObjects: number;
  namespaceFilters: string[];
  policyFilters: string[];
  authMountFilters: string[];
  authTypeFilters: string[];
  skipIdentity: boolean;
}
export function parseCollectionOptions(raw: unknown): CollectionOptions {
  if (raw === undefined) raw = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Collection options must be an object');
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'workers',
          'retries',
          'requestsPerSecond',
          'retryBackoffMs',
          'timeoutMs',
          'maxDurationMs',
          'maxObjects',
          'namespaceFilters',
          'policyFilters',
          'authMountFilters',
          'authTypeFilters',
          'skipIdentity',
          'namespace',
          'redactPolicySource',
          'recursiveNamespaces',
          'sources',
        ].includes(key),
    )
  )
    throw new Error('Unknown collection option');
  const options = {
    ...DEFAULT_REQUEST_POLICY,
    workers: 10,
    timeoutMs: 30000,
    maxDurationMs: 7200000,
    maxObjects: 0,
    namespaceFilters: [],
    policyFilters: [],
    authMountFilters: [],
    authTypeFilters: [],
    skipIdentity: false,
    redactPolicySource: false,
    recursiveNamespaces: false,
    namespace: '',
    sources: COLLECTION_SOURCES,
    ...value,
  } as CollectionOptions;
  for (const key of [
    'workers',
    'retries',
    'requestsPerSecond',
    'retryBackoffMs',
    'timeoutMs',
    'maxDurationMs',
    'maxObjects',
  ] as const)
    if (typeof options[key] !== 'number')
      throw new Error('Collection options must be numeric');
  if (typeof options.recursiveNamespaces !== 'boolean')
    throw new Error('recursiveNamespaces must be boolean');
  if (typeof options.redactPolicySource !== 'boolean')
    throw new Error('redactPolicySource must be boolean');
  if (typeof options.skipIdentity !== 'boolean')
    throw new Error('skipIdentity must be boolean');
  for (const key of [
    'namespaceFilters',
    'policyFilters',
    'authMountFilters',
    'authTypeFilters',
  ] as const) {
    if (
      !Array.isArray(options[key]) ||
      options[key].length > 100 ||
      options[key].some(
        (v) => typeof v !== 'string' || !v.trim() || v.length > 256,
      )
    )
      throw new Error(`Invalid ${key}`);
    options[key] = [...new Set(options[key])].sort();
  }
  if (
    !Array.isArray(options.sources) ||
    !options.sources.length ||
    options.sources.some((source) => !COLLECTION_SOURCES.includes(source))
  )
    throw new Error('Invalid collection sources');
  options.sources = [...new Set(options.sources)].sort();
  options.namespace = normalizeNamespace(options.namespace);
  validateRequestPolicy(options);
  if (
    !Number.isInteger(options.workers) ||
    options.workers < 1 ||
    options.workers > 32
  )
    throw new Error('workers must be an integer from 1 to 32');
  for (const key of ['timeoutMs', 'maxDurationMs'] as const)
    if (
      !Number.isInteger(options[key]) ||
      options[key] < 1 ||
      options[key] > 86400000
    )
      throw new Error(`${key} must be from 1 to 86400000`);
  if (
    !Number.isInteger(options.maxObjects) ||
    options.maxObjects < 0 ||
    options.maxObjects > 10000000
  )
    throw new Error('maxObjects must be an integer from 0 to 10000000');
  return options;
}
