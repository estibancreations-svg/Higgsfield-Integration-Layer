create extension if not exists pgcrypto;

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  workflow_type text not null,
  request_params jsonb not null default '{}'::jsonb,
  job_id text not null unique,
  model_used text not null,
  credits_used numeric(12, 2),
  status text not null check (status in ('queued', 'rendering', 'complete', 'failed')) default 'queued',
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  media_url text,
  error_message text,
  retry_count integer not null default 0
);

create table if not exists public.media_library (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  media_url text not null,
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  project_association text not null,
  provenance_chain jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  amount numeric(12, 2) not null,
  job_id text,
  status text not null check (status in ('pending', 'posted', 'reversed', 'failed')) default 'pending',
  transaction_date timestamptz not null default timezone('utc', now()),
  balance_after numeric(12, 2) not null,
  description text not null
);

create table if not exists public.job_state (
  job_id text primary key,
  higgsfield_job_id text not null unique,
  status text not null check (status in ('queued', 'rendering', 'complete', 'failed')) default 'queued',
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  started_at timestamptz not null default timezone('utc', now()),
  estimated_completion timestamptz,
  error_state text,
  triggered_by text not null default 'unknown',
  generation_parameters jsonb not null default '{}'::jsonb,
  concurrency_lease_token uuid
);

alter table if exists public.job_state
  add column if not exists concurrency_lease_token uuid;

create table if not exists public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  limiter_key text not null,
  event_type text not null check (event_type in ('request', 'concurrency')),
  lease_token uuid unique,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

create or replace function public.acquire_rate_limit_lease(
  p_limiter_key text,
  p_limit integer,
  p_window_ms integer,
  p_concurrent_limit integer,
  p_lease_ms integer
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz,
  retry_after_seconds integer,
  lease_token uuid
)
language plpgsql
security definer
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_window_start timestamptz := v_now - ((p_window_ms::text || ' milliseconds')::interval);
  v_reset_at timestamptz := v_now + ((p_window_ms::text || ' milliseconds')::interval);
  v_lease_expires_at timestamptz := v_now + ((p_lease_ms::text || ' milliseconds')::interval);
  v_request_count integer;
  v_concurrency_count integer;
  v_lease_token uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_limiter_key, 0));

  delete from public.rate_limit_events
  where limiter_key = p_limiter_key
    and expires_at < v_now;

  select count(*)
    into v_request_count
  from public.rate_limit_events
  where limiter_key = p_limiter_key
    and event_type = 'request'
    and created_at >= v_window_start;

  select count(*)
    into v_concurrency_count
  from public.rate_limit_events
  where limiter_key = p_limiter_key
    and event_type = 'concurrency'
    and expires_at > v_now;

  if v_request_count >= p_limit or v_concurrency_count >= p_concurrent_limit then
    allowed := false;
    remaining := greatest(0, p_limit - v_request_count);
    reset_at := v_reset_at;
    retry_after_seconds := greatest(1, ceil(p_window_ms / 1000.0)::integer);
    lease_token := null;
    return next;
    return;
  end if;

  v_lease_token := gen_random_uuid();

  insert into public.rate_limit_events (limiter_key, event_type, expires_at)
  values (p_limiter_key, 'request', v_reset_at);

  insert into public.rate_limit_events (limiter_key, event_type, lease_token, expires_at)
  values (p_limiter_key, 'concurrency', v_lease_token, v_lease_expires_at);

  allowed := true;
  remaining := greatest(0, p_limit - (v_request_count + 1));
  reset_at := v_reset_at;
  retry_after_seconds := null;
  lease_token := v_lease_token;
  return next;
end;
$$;

create or replace function public.release_rate_limit_lease(p_lease_token uuid)
returns void
language sql
security definer
as $$
  delete from public.rate_limit_events
  where lease_token = p_lease_token
    and event_type = 'concurrency';
$$;

create index if not exists generations_project_status_idx on public.generations (project_id, status, created_at desc);
create index if not exists media_library_project_type_idx on public.media_library (project_association, media_type, created_at desc);
create index if not exists credit_transactions_account_date_idx on public.credit_transactions (account_id, transaction_date desc);
create index if not exists job_state_status_idx on public.job_state (status, estimated_completion);
create index if not exists rate_limit_events_lookup_idx on public.rate_limit_events (limiter_key, event_type, created_at desc);
create index if not exists rate_limit_events_expiry_idx on public.rate_limit_events (limiter_key, expires_at);
