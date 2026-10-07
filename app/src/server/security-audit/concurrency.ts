export async function forEachConcurrent<T>(
  items: T[],
  workers: number,
  operation: (item: T) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(workers) || workers < 1 || workers > 32)
    throw new Error('workers must be an integer from 1 to 32');
  let index = 0,
    failed = false;
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (!failed && index < items.length) {
        const item = items[index++];
        try {
          await operation(item);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }),
  );
  const error = results.find((result) => result.status === 'rejected');
  if (error?.status === 'rejected') throw error.reason;
}
