-- Consolidated hardening migration for LegendaryAI (idempotent).
-- Apply in staging first, verify the active Owner account, then apply in production.
-- Rollback guidance: revert the calling Edge Function/UI code first. Do NOT drop populated
-- consent, support, refund, or transaction tables as a rollback shortcut.

-- Keep paid-order audit records when the account is deleted; remove the direct account link.
alter table public.orders alter column user_id drop not null;
alter table public.orders drop constraint if exists orders_user_id_fkey;
alter table public.orders add constraint orders_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table public.orders add column if not exists provider_transaction_id text;
create unique index if not exists orders_provider_transaction_id_uidx
  on public.orders(provider_transaction_id)
  where provider_transaction_id is not null;

-- Consent evidence contains policy/version/time only. No IP address is collected by this trigger.
create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  policy_key text not null check (policy_key in ('terms','privacy')),
  version text not null,
  accepted_at timestamptz not null default now(),
  ip_hash text,
  created_at timestamptz not null default now(),
  unique (user_id, policy_key, version)
);
alter table public.user_consents enable row level security;
revoke all on public.user_consents from public, anon, authenticated;
grant select, insert, update on public.user_consents to service_role;

create or replace function public.capture_signup_consents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  consent_version text;
  consent_data jsonb;
begin
  consent_data := new.raw_user_meta_data->'legal_consent';
  if consent_data is null
     or consent_data->>'terms' <> 'true'
     or consent_data->>'privacy' <> 'true' then
    return new;
  end if;

  consent_version := left(coalesce(nullif(consent_data->>'version',''), '1.0.0'), 32);

  insert into public.user_consents (user_id, policy_key, version, accepted_at, ip_hash)
  values (new.id, 'terms', consent_version, now(), null)
  on conflict (user_id, policy_key, version) do nothing;

  insert into public.user_consents (user_id, policy_key, version, accepted_at, ip_hash)
  values (new.id, 'privacy', consent_version, now(), null)
  on conflict (user_id, policy_key, version) do nothing;

  return new;
end;
$$;
revoke all on function public.capture_signup_consents() from public, anon, authenticated;
drop trigger if exists capture_legal_consent_after_signup on auth.users;
create trigger capture_legal_consent_after_signup
  after insert on auth.users
  for each row execute procedure public.capture_signup_consents();

-- Idempotent, explicit retention controls. NULL + disabled means cleanup remains off.
create table if not exists public.retention_settings (
  key text primary key check (key in ('chat','usage_logs','memories','attachments','support_requests')),
  retention_days integer check (retention_days is null or retention_days > 0),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.retention_settings enable row level security;
revoke all on public.retention_settings from public, anon, authenticated;
grant select, insert, update, delete on public.retention_settings to service_role;
insert into public.retention_settings (key, retention_days, enabled) values
  ('chat', null, false),
  ('usage_logs', null, false),
  ('memories', null, false),
  ('attachments', null, false),
  ('support_requests', null, false)
on conflict (key) do nothing;

-- Minimal inbox for the public contact/complaint form. The service role is the only DB API role.
create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  contact_email text not null,
  topic text not null check (topic in ('privacy','billing','bug','abuse','other')),
  message text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_requests_status_created_idx
  on public.support_requests(status, created_at);
alter table public.support_requests enable row level security;
revoke all on public.support_requests from public, anon, authenticated;
grant select, insert, update, delete on public.support_requests to service_role;

-- Record cumulative refund amount per one reservation so repeated failure handlers cannot
-- refund the same reservation twice. p_amount is the cumulative target to refund, not a delta.
create table if not exists public.token_refunds (
  user_id uuid not null references auth.users(id) on delete cascade,
  reservation_id text not null,
  reserved_tokens integer not null check (reserved_tokens > 0),
  refunded_tokens integer not null default 0 check (refunded_tokens >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, reservation_id),
  check (refunded_tokens <= reserved_tokens)
);
alter table public.token_refunds enable row level security;
revoke all on public.token_refunds from public, anon, authenticated;
grant select, insert, update on public.token_refunds to service_role;

create or replace function public.refund_tokens(
  p_amount integer,
  p_user_id uuid,
  p_request_id text,
  p_reserved integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := p_user_id;
  caller_uid uuid := auth.uid();
  previous_refund integer;
  original_reservation integer;
  target_refund integer;
  refund_delta integer;
begin
  if uid is null or p_request_id is null or length(p_request_id) < 8
     or p_reserved is null or p_reserved <= 0 or p_amount is null or p_amount < 0 then
    return false;
  end if;
  if caller_uid is not null and caller_uid <> uid then
    return false;
  end if;

  target_refund := least(p_amount, p_reserved);

  insert into public.token_refunds (user_id, reservation_id, reserved_tokens, refunded_tokens)
  values (uid, p_request_id, p_reserved, 0)
  on conflict (user_id, reservation_id) do nothing;

  select refunded_tokens, reserved_tokens
    into previous_refund, original_reservation
    from public.token_refunds
   where user_id = uid and reservation_id = p_request_id
   for update;

  if not found or original_reservation <> p_reserved then
    return false;
  end if;
  if target_refund <= previous_refund then
    return true;
  end if;

  refund_delta := target_refund - previous_refund;
  update public.profiles
     set tokens_used = greatest(tokens_used - refund_delta, 0),
         updated_at = now()
   where id = uid;
  if not found then
    return false;
  end if;

  update public.token_refunds
     set refunded_tokens = target_refund, updated_at = now()
   where user_id = uid and reservation_id = p_request_id;
  return true;
end;
$$;

-- The old 2-argument endpoint had no idempotency key. Edge Functions in this PR use the
-- request-scoped 4-argument contract exclusively.
revoke all on function public.refund_tokens(integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.refund_tokens(integer, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.refund_tokens(integer, uuid, text, integer) to service_role;

-- MoMo IPNs are authenticated by HMAC in momo-ipn. This RPC performs the actual database
-- transition under a row lock, binds the request/transaction to the order, and is idempotent.
create or replace function public.finalize_momo_payment(
  p_order_id uuid,
  p_request_id text,
  p_success boolean,
  p_result_code integer,
  p_message text,
  p_paid_at timestamptz,
  p_provider_transaction_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_plan public.plans%rowtype;
  v_profile public.profiles%rowtype;
  v_expiry timestamptz;
  v_period interval;
begin
  select * into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;
  if p_request_id is null or p_request_id <> v_order.provider_request_id then
    return jsonb_build_object('ok', false, 'error', 'REQUEST_ID_MISMATCH');
  end if;

  if v_order.status = 'paid' then
    if p_success and p_provider_transaction_id is not null
       and p_provider_transaction_id = v_order.provider_transaction_id then
      return jsonb_build_object('ok', true, 'already_processed', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'ORDER_ALREADY_FINALIZED');
  end if;

  if v_order.status = 'failed' or v_order.status = 'cancelled' then
    if not p_success then
      return jsonb_build_object('ok', true, 'already_processed', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'ORDER_ALREADY_FINALIZED');
  end if;
  if v_order.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ORDER_STATE');
  end if;

  if not p_success then
    update public.orders
       set status = 'failed',
           provider_result_code = p_result_code,
           provider_message = left(coalesce(p_message, ''), 500),
           updated_at = now()
     where id = v_order.id;
    return jsonb_build_object('ok', true, 'already_processed', false);
  end if;

  if v_order.user_id is null or p_provider_transaction_id is null
     or length(p_provider_transaction_id) = 0 then
    return jsonb_build_object('ok', false, 'error', 'MISSING_ORDER_OR_TRANSACTION');
  end if;

  if exists (
    select 1 from public.orders o
     where o.provider_transaction_id = p_provider_transaction_id
       and o.id <> v_order.id
  ) then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_ALREADY_USED');
  end if;

  select * into v_plan from public.plans where key = v_order.plan;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'PLAN_NOT_FOUND');
  end if;

  select * into v_profile
    from public.profiles
   where id = v_order.user_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  end if;

  v_period := case v_plan.billing_period
    when 'day' then interval '1 day'
    when 'week' then interval '1 week'
    when 'year' then interval '1 year'
    when 'session' then interval '1 hour'
    else interval '1 month'
  end;

  if v_profile.role <> 'owner' then
    if v_profile.plan = v_order.plan
       and v_profile.plan_expires_at is not null
       and v_profile.plan_expires_at > now() then
      v_expiry := v_profile.plan_expires_at + v_period;
    else
      v_expiry := now() + v_period;
    end if;

    update public.profiles
       set plan = v_plan.key,
           plan_id = v_plan.id,
           token_limit = v_plan.token_limit,
           tokens_used = 0,
           token_reset_at = now() + make_interval(hours => greatest(v_plan.reset_hours, 1)),
           plan_expires_at = v_expiry,
           memory_enabled = coalesce((v_plan.capabilities->>'memory')::boolean, false),
           vision_enabled = coalesce((v_plan.capabilities->>'vision')::boolean, false),
           web_search_enabled = coalesce((v_plan.capabilities->>'webSearch')::boolean, false),
           updated_at = now()
     where id = v_profile.id;
  end if;

  update public.orders
     set status = 'paid',
         provider_result_code = p_result_code,
         provider_message = left(coalesce(p_message, ''), 500),
         provider_transaction_id = p_provider_transaction_id,
         paid_at = coalesce(p_paid_at, now()),
         expires_at = v_expiry,
         updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('ok', true, 'already_processed', false, 'plan_expires_at', v_expiry);
end;
$$;

revoke all on function public.finalize_momo_payment(uuid, text, boolean, integer, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.finalize_momo_payment(uuid, text, boolean, integer, text, timestamptz, text)
  to service_role;

-- Harden RLS initplans and prevent privileged RPCs from being called by client roles.
drop policy if exists "profiles own select" on public.profiles;
create policy "profiles own select" on public.profiles for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "conversations own rows" on public.conversations;
create policy "conversations own rows" on public.conversations for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "messages own rows" on public.messages;
create policy "messages own rows" on public.messages for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "orders own rows" on public.orders;
create policy "orders own rows" on public.orders for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "chat attachments own read" on storage.objects;
create policy "chat attachments own read" on storage.objects for select to authenticated using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "chat attachments own insert" on storage.objects;
create policy "chat attachments own insert" on storage.objects for insert to authenticated with check (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "chat attachments own delete" on storage.objects;
create policy "chat attachments own delete" on storage.objects for delete to authenticated using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "ai models public enabled read" on public.ai_models;
create policy "ai models public enabled read" on public.ai_models for select to anon, authenticated using (enabled = true or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'));
drop policy if exists "ai models owner write" on public.ai_models;
create policy "ai models owner write" on public.ai_models for all to authenticated using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner')) with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'));
drop policy if exists "ai memories own rows" on public.ai_memories;
create policy "ai memories own rows" on public.ai_memories for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "ai usage own read" on public.ai_usage_logs;
create policy "ai usage own read" on public.ai_usage_logs for select to authenticated using ((select auth.uid()) = user_id);

revoke all on function public.consume_tokens(integer, uuid, boolean) from public, anon, authenticated;
grant execute on function public.consume_tokens(integer, uuid, boolean) to service_role;
revoke all on function public.refund_tokens(integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finalize_tokens(integer, integer) from public, anon, authenticated, service_role;

-- Never bootstrap Owner based on a matching email. Existing roles are preserved.
