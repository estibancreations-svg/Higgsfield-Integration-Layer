interface RateLimitState {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds?: number;
}

const counters = new Map<string, RateLimitState>();
const concurrency = new Map<string, number>();

export function enforceRateLimit(options: { key: string; limit?: number; windowMs?: number; concurrentLimit?: number }): RateLimitResult {
  const limit = options.limit ?? Number(process.env.DEFAULT_RATE_LIMIT ?? 30);
  const windowMs = options.windowMs ?? Number(process.env.DEFAULT_RATE_LIMIT_WINDOW_MS ?? 60_000);
  const concurrentLimit = options.concurrentLimit ?? Number(process.env.DEFAULT_MAX_CONCURRENT_JOBS ?? 5);
  const now = Date.now();

  const current = counters.get(options.key);
  const active = concurrency.get(options.key) ?? 0;

  if (active >= concurrentLimit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: now + windowMs,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (!current || current.resetAt <= now) {
    counters.set(options.key, { count: 1, resetAt: now + windowMs });
    concurrency.set(options.key, active + 1);
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetAt: now + windowMs,
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  counters.set(options.key, current);
  concurrency.set(options.key, active + 1);

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt,
  };
}

export function releaseConcurrency(key: string): void {
  const active = concurrency.get(key) ?? 0;
  if (active <= 1) {
    concurrency.delete(key);
    return;
  }

  concurrency.set(key, active - 1);
}
