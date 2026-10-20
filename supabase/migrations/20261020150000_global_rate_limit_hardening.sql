-- Shared database-backed rate limiting for Edge Function isolates.
-- Keys are SHA-256 hashes created by the Edge Function; raw user IDs/IPs are never stored here.
create table if not exists public.api_rate_limit_buckets (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  last_request_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists api_rate_limit_buckets_updated_idx
  on public.api_rate_limit_buckets(updated_at);

alter table public.api_rate_limit_buckets enable row level security;
revoke all on public.api_rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on public.api_rate_limit_buckets to service_role;

create or replace function public.check_api_rate_limit(
  p_key_hash text,
  p_now timestamptz,
  p_window_seconds integer,
  p_max_requests integer,
  p_min_interval_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.api_rate_limit_buckets%rowtype;
  v_retry_after integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$'
     or p_now is null
     or p_window_seconds < 1 or p_window_seconds > 3600
     or p_max_requests < 1 or p_max_requests > 10000
     or p_min_interval_ms < 0 or p_min_interval_ms > 60000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RATE_LIMIT_ARGS', 'retry_after', 1);
  end if;

  -- Perform a small bounded cleanup at most once per minute as traffic arrives.
  -- The separate advisory lock prevents a burst of requests from each running cleanup.
  if mod(floor(extract(epoch from p_now))::bigint, 60) = 0
     and pg_try_advisory_xact_lock(7391827364::bigint) then
    delete from public.api_rate_limit_buckets
     where key_hash in (
       select key_hash
         from public.api_rate_limit_buckets
        where updated_at < p_now - interval '1 hour'
        order by updated_at
        limit 250
     );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));
  select * into v
    from public.api_rate_limit_buckets
   where key_hash = p_key_hash
   for update;

  if not found then
    insert into public.api_rate_limit_buckets(
      key_hash, window_started_at, request_count, last_request_at, updated_at
    ) values (p_key_hash, p_now, 1, p_now, p_now);
    return jsonb_build_object('ok', true, 'code', '', 'retry_after', 0);
  end if;

  if p_now >= v.window_started_at + make_interval(secs => p_window_seconds) then
    update public.api_rate_limit_buckets
       set window_started_at = p_now,
           request_count = 1,
           last_request_at = p_now,
           updated_at = p_now
     where key_hash = p_key_hash;
    return jsonb_build_object('ok', true, 'code', '', 'retry_after', 0);
  end if;

  if p_now - v.last_request_at < make_interval(secs => p_min_interval_ms::double precision / 1000.0) then
    return jsonb_build_object('ok', false, 'code', 'REQUEST_BURST', 'retry_after', 1);
  end if;

  if v.request_count >= p_max_requests then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (v.window_started_at + make_interval(secs => p_window_seconds) - p_now)))::integer
    );
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'retry_after', v_retry_after);
  end if;

  update public.api_rate_limit_buckets
     set request_count = request_count + 1,
         last_request_at = p_now,
         updated_at = p_now
   where key_hash = p_key_hash;

  return jsonb_build_object('ok', true, 'code', '', 'retry_after', 0);
end;
$$;

revoke all on function public.check_api_rate_limit(text, timestamptz, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_api_rate_limit(text, timestamptz, integer, integer, integer)
  to service_role;
