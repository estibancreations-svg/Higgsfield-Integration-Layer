import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
  leaseToken?: string;
  backend: 'supabase' | 'memory';
}

const counters = new Map<string, RateLimitState>();
const concurrency = new Map<string, number>();

let supabaseClient: SupabaseClient | null | undefined;

function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient !== undefined) {
    return supabaseClient;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  supabaseClient = url && key ? createClient(url, key) : null;
  return supabaseClient;
}

function getWindowConfig(options: { limit?: number; windowMs?: number; concurrentLimit?: number }) {
  return {
    limit: options.limit ?? Number(process.env.DEFAULT_RATE_LIMIT ?? 30),
    windowMs: options.windowMs ?? Number(process.env.DEFAULT_RATE_LIMIT_WINDOW_MS ?? 60_000),
    concurrentLimit: options.concurrentLimit ?? Number(process.env.DEFAULT_MAX_CONCURRENT_JOBS ?? 5),
    leaseMs: Number(process.env.DEFAULT_CONCURRENCY_LEASE_MS ?? 3_600_000),
  };
}

export async function enforceRateLimit(options: {
  key: string;
  limit?: number;
  windowMs?: number;
  concurrentLimit?: number;
}): Promise<RateLimitResult> {
  const client = getSupabaseClient();
  return client ? enforceSupabaseRateLimit(client, options) : enforceInMemoryRateLimit(options);
}

async function enforceSupabaseRateLimit(
  client: SupabaseClient,
  options: { key: string; limit?: number; windowMs?: number; concurrentLimit?: number },
): Promise<RateLimitResult> {
  const { limit, windowMs, concurrentLimit, leaseMs } = getWindowConfig(options);
  const now = Date.now();
  const { data, error } = await client.rpc('acquire_rate_limit_lease', {
    p_limiter_key: options.key,
    p_limit: limit,
    p_window_ms: windowMs,
    p_concurrent_limit: concurrentLimit,
    p_lease_ms: leaseMs,
  });

  if (error) {
    throw new Error(`Rate limit lookup failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error('Rate limit function returned no result.');
  }

  if (!row.allowed) {
    return {
      allowed: false,
      limit,
      remaining: Number(row.remaining ?? 0),
      resetAt: new Date(row.reset_at ?? now + windowMs).getTime(),
      retryAfterSeconds: Number(row.retry_after_seconds ?? Math.ceil(windowMs / 1000)),
      backend: 'supabase',
    };
  }

  return {
    allowed: true,
    limit,
    remaining: Number(row.remaining ?? Math.max(0, limit - 1)),
    resetAt: new Date(row.reset_at ?? now + windowMs).getTime(),
    leaseToken: typeof row.lease_token === 'string' ? row.lease_token : undefined,
    backend: 'supabase',
  };
}

function enforceInMemoryRateLimit(options: {
  key: string;
  limit?: number;
  windowMs?: number;
  concurrentLimit?: number;
}): RateLimitResult {
  const { limit, windowMs, concurrentLimit } = getWindowConfig(options);
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
      backend: 'memory',
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
      backend: 'memory',
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      backend: 'memory',
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
    backend: 'memory',
  };
}

export async function releaseConcurrency(key: string, leaseToken?: string): Promise<void> {
  const client = getSupabaseClient();
  if (client && leaseToken) {
    await client.rpc('release_rate_limit_lease', { p_lease_token: leaseToken });
    return;
  }

  const active = concurrency.get(key) ?? 0;
  if (active <= 1) {
    concurrency.delete(key);
    return;
  }

  concurrency.set(key, active - 1);
}
