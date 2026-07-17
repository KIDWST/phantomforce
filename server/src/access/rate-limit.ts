/* Dependency-free in-memory rate limiter for auth endpoints.
   Keyed per-process; fine for a single-instance deployment. If PhantomForce
   ever runs multiple server instances behind a shared load balancer, this
   must move to a shared store (Redis/Postgres) or each instance under-counts. */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  limited: boolean;
  remaining: number;
  retryAfterMs: number;
};

export function consumeRateLimit(key: string, max: number, windowMs: number, now = Date.now()): RateLimitResult {
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, remaining: Math.max(0, max - 1), retryAfterMs: windowMs };
  }

  existing.count += 1;
  if (existing.count > max) {
    return { limited: true, remaining: 0, retryAfterMs: Math.max(0, existing.resetAt - now) };
  }

  return { limited: false, remaining: Math.max(0, max - existing.count), retryAfterMs: Math.max(0, existing.resetAt - now) };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}

/* test-only introspection */
export function _rateLimitBucketCount() {
  return buckets.size;
}

export function _clearAllRateLimits() {
  buckets.clear();
}
