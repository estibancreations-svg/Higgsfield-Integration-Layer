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
  const { limit, windowMs, concurrentLimit } = getWindowConfig(options);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const windowStartIso = new Date(now - windowMs).toISOString();
  const expiresAt = new Date(now + windowMs).toISOString();

  await client.from('rate_limit_events').delete().lt('expires_at', nowIso).eq('limiter_key', options.key);

  const [{ count: requestCount, error: requestError }, { count: activeLeases, error: concurrencyError }] = await Promise.all([
    client
      .from('rate_limit_events')
      .select('*', { count: 'exact', head: true })
      .eq('limiter_key', options.key)
      .eq('event_type', 'request')
      .gte('created_at', windowStartIso),
    client
      .from('rate_limit_events')
      .select('*', { count: 'exact', head: true })
      .eq('limiter_key', options.key)
      .eq('event_type', 'concurrency')
      .gt('expires_at', nowIso),
  ]);

  if (requestError || concurrencyError) {
    throw new Error(`Rate limit lookup failed: ${requestError?.message ?? concurrencyError?.message}`);
  }

  if ((activeLeases ?? 0) >= concurrentLimit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: now + windowMs,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
      backend: 'supabase',
    };
  }

  if ((requestCount ?? 0) >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: now + windowMs,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
      backend: 'supabase',
    };
  }

  const leaseToken = crypto.randomUUID();
  const { error: insertError } = await client.from('rate_limit_events').insert([
    {
      limiter_key: options.key,
      event_type: 'request',
      expires_at: expiresAt,
    },
    {
      limiter_key: options.key,
      event_type: 'concurrency',
      lease_token: leaseToken,
      expires_at: expiresAt,
    },
  ]);

  if (insertError) {
    throw new Error(`Rate limit write failed: ${insertError.message}`);
  }

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - ((requestCount ?? 0) + 1)),
    resetAt: now + windowMs,
    leaseToken,
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
    await client.from('rate_limit_events').delete().eq('lease_token', leaseToken).eq('event_type', 'concurrency');
    return;
  }

  const active = concurrency.get(key) ?? 0;
  if (active <= 1) {
    concurrency.delete(key);
    return;
  }

  concurrency.set(key, active - 1);
}
