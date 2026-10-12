/**
 * Minimal fixed-window rate limiter per key (kept in memory, good enough for a single instance)
 */
export function createRateLimiter(windowMs = 60_000) {
  const counters = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of counters) if (entry.start < cutoff) counters.delete(key);
  }, windowMs);
  timer.unref();

  return {
    allow(key, limit) {
      const now = Date.now();
      let entry = counters.get(key);
      if (!entry || now - entry.start >= windowMs) {
        entry = { start: now, count: 0 };
        counters.set(key, entry);
      }
      entry.count++;
      return entry.count <= limit;
    },
  };
}
