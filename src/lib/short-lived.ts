/**
 * Wraps an expensive async read so calls with the same key within `ttlMs`
 * share one result, and concurrent calls share one in-flight request. A
 * rejection is never kept: the next call tries again.
 *
 * ponytail: per-process Map, never pruned — fine for a handful of keys; give
 * it an eviction policy before keying it on anything user-supplied.
 */
export function shortLived<K, T>(
  ttlMs: number,
  read: (key: K) => Promise<T>,
  clock: () => number = Date.now
): (key: K) => Promise<T> {
  const kept = new Map<K, { at: number; value: Promise<T> }>();
  return (key) => {
    const hit = kept.get(key);
    if (hit && clock() - hit.at < ttlMs) return hit.value;
    const entry = { at: clock(), value: read(key) };
    kept.set(key, entry);
    entry.value.catch(() => {
      if (kept.get(key) === entry) kept.delete(key);
    });
    return entry.value;
  };
}
