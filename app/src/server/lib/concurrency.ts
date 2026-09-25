/**
 * Runs `fn` over every item with at most `limit` calls in-flight at once.
 * Use for fan-out over Vault API calls (one request per entity/group/role/...)
 * so a large Vault install can't turn a single request into thousands of
 * simultaneous outbound calls.
 */
export async function concurrentMap<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
