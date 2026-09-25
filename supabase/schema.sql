-- LegendaryAI production schema
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  role text not null default 'user' check (role in ('user','admin','owner')),
  plan text not null default 'free' check (plan in ('free','pro','legendary')),
  token_limit integer not null default 250000,
  memory_enabled boolean not null default false,
  vision_enabled boolean not null default false,
  web_search_enabled boolean not null default false,
  tokens_used integer not null default 0,
  token_reset_at timestamptz not null default (now() + interval '1 day'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists memory_enabled boolean not null default false;
alter table public.profiles add column if not exists vision_enabled boolean not null default false;
alter table public.profiles add column if not exists web_search_enabled boolean not null default false;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('user','admin','owner'));

create table if not exists public.conversations (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Cuộc trò chuyện mới',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id text primary key,
  conversation_id text not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','ai','assistant','system')),
  content text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('pro','legendary')),
  amount bigint not null,
  currency text not null default 'VND',
  provider text not null default 'momo',
  provider_order_id text unique,
  provider_request_id text,
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  provider_result_code integer,
  provider_message text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_updated_idx
  on public.conversations(user_id, updated_at desc);
create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at);
create index if not exists orders_user_created_idx
  on public.orders(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.orders enable row level security;

drop policy if exists "profiles own row" on public.profiles;
drop policy if exists "profiles own select" on public.profiles;
create policy "profiles own select" on public.profiles
  for select using (auth.uid() = id);

-- Profiles are created by the auth trigger and plan/token_limit are server-controlled.
-- Do not grant client insert/update/delete access to profiles.

drop policy if exists "conversations own rows" on public.conversations;
create policy "conversations own rows" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "messages own rows" on public.messages;
create policy "messages own rows" on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "orders own rows" on public.orders;
create policy "orders own rows" on public.orders
  for select using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $
declare new_role text := 'user';
begin
  if lower(coalesce(new.email, '')) = 'ltrtrongphu@gmail.com' then
    new_role := 'owner';
  end if;

  insert into public.profiles (id, display_name, avatar_url, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    new_role
  )
  on conflict (id) do update set
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);

  return new;
end;
$;

-- Grant Owner to the existing account, if it already exists.
update public.profiles p
set role = 'owner', updated_at = now()
from auth.users u
where p.id = u.id
  and lower(coalesce(u.email, '')) = 'ltrtrongphu@gmail.com';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Storage for user attachments.
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

drop policy if exists "chat attachments own read" on storage.objects;
create policy "chat attachments own read" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "chat attachments own insert" on storage.objects;
create policy "chat attachments own insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "chat attachments own delete" on storage.objects;
create policy "chat attachments own delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- Atomic token debit helper. The AI backend should call this before generating a response.
create or replace function public.consume_tokens(p_amount integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  allowed boolean;
begin
  if uid is null or p_amount <= 0 then return false; end if;
  update public.profiles
     set tokens_used = case
       when token_reset_at <= now() then p_amount
       else tokens_used + p_amount
     end,
     token_reset_at = case
       when token_reset_at <= now() then now() + interval '1 day'
       else token_reset_at
     end,
     updated_at = now()
   where id = uid
     and case
       when token_reset_at <= now() then p_amount <= token_limit
       else tokens_used + p_amount <= token_limit
     end
   returning true into allowed;
  return coalesce(allowed, false);
end;
$$;

revoke all on function public.consume_tokens(integer) from public;
grant execute on function public.consume_tokens(integer) to authenticated;


-- Optional model registry for Owner-controlled model profiles.
create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  display_name text not null,
  tier text not null default 'free' check (tier in ('free','pro','legendary','system')),
  provider text not null check (provider in ('openai-compatible','anthropic-compatible')),
  model_id text not null,
  base_url text,
  base_url_env text,
  api_key_env text,
  context_window integer not null default 32768,
  max_output_tokens integer not null default 4096,
  capabilities jsonb not null default '[]'::jsonb,
  system_prompt text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_models add column if not exists tier text not null default 'free';
alter table public.ai_models add column if not exists base_url_env text;
alter table public.ai_models add column if not exists api_key_env text;
alter table public.ai_models add column if not exists context_window integer not null default 32768;
alter table public.ai_models add column if not exists max_output_tokens integer not null default 4096;
alter table public.ai_models add column if not exists capabilities jsonb not null default '[]'::jsonb;

alter table public.ai_models enable row level security;
drop policy if exists "ai models public enabled read" on public.ai_models;
create policy "ai models public enabled read" on public.ai_models
  for select using (enabled = true or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'owner'
  ));
drop policy if exists "ai models owner write" on public.ai_models;
create policy "ai models owner write" on public.ai_models
  for all using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'
  )) with check (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'
  ));

insert into public.ai_models
  (key, display_name, tier, provider, model_id, base_url_env, api_key_env, context_window, max_output_tokens, capabilities, system_prompt)
values
(
  'legendary-lite-1',
  'LegendaryLite-1',
  'free',
  'openai-compatible',
  'YOUR_FREE_MODEL',
  'AI_FREE_API_URL',
  'AI_FREE_API_KEY',
  32768,
  4096,
  '["chat","code","writing","files"]'::jsonb,
  'You are LegendaryLite-1, the Free-tier assistant of LegendaryAI. Be concise, accurate, helpful, and efficient.'
),
(
  'legendary-pro-1',
  'LegendaryPro-1',
  'pro',
  'openai-compatible',
  'YOUR_PRO_MODEL',
  'AI_PRO_API_URL',
  'AI_PRO_API_KEY',
  65536,
  8192,
  '["chat","code","writing","files","vision","memory"]'::jsonb,
  'You are LegendaryPro-1, the Pro-tier assistant of LegendaryAI. Reason carefully, preserve context, produce production-ready code, and explain trade-offs clearly.'
),
(
  'legendary-ultra-1',
  'LegendaryUltra-1',
  'legendary',
  'openai-compatible',
  'YOUR_LEGENDARY_MODEL',
  'AI_LEGENDARY_API_URL',
  'AI_LEGENDARY_API_KEY',
  131072,
  16384,
  '["chat","code","writing","files","vision","memory","web_search","tools"]'::jsonb,
  'You are LegendaryUltra-1, the highest-tier assistant of LegendaryAI. Prioritize deep reasoning, robust code, long-context synthesis, tool planning, and explicit uncertainty handling.'
),
(
  'custom',
  'Custom Model',
  'system',
  'openai-compatible',
  'YOUR_CUSTOM_MODEL',
  'AI_CUSTOM_API_URL',
  'AI_CUSTOM_API_KEY',
  131072,
  16384,
  '["chat","code","writing","files","vision","memory","tools"]'::jsonb,
  'You are a custom model integrated into LegendaryAI. Follow system instructions precisely and preserve context.'
)
on conflict (key) do update set
  display_name = excluded.display_name,
  tier = excluded.tier,
  provider = excluded.provider,
  base_url_env = excluded.base_url_env,
  api_key_env = excluded.api_key_env,
  context_window = excluded.context_window,
  max_output_tokens = excluded.max_output_tokens,
  capabilities = excluded.capabilities,
  system_prompt = excluded.system_prompt,
  updated_at = now();

-- Owner can list users and orders only through the owner-only edge function.


-- Least-privilege Data API grants.
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select on public.orders to authenticated;
grant select, insert, update, delete on public.ai_models to authenticated;


create table if not exists public.ai_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory text not null,
  source text,
  importance integer not null default 5 check (importance between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_memories_user_idx
  on public.ai_memories(user_id, importance desc, updated_at desc);

alter table public.ai_memories enable row level security;
drop policy if exists "ai memories own rows" on public.ai_memories;
create policy "ai memories own rows" on public.ai_memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.ai_memories to authenticated;

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model_key text,
  provider_model text,
  plan text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  reserved_tokens integer not null default 0,
  request_ms integer,
  status text not null default 'success' check (status in ('success','error')),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_user_created_idx
  on public.ai_usage_logs(user_id, created_at desc);

alter table public.ai_usage_logs enable row level security;
drop policy if exists "ai usage own read" on public.ai_usage_logs;
create policy "ai usage own read" on public.ai_usage_logs
  for select using (auth.uid() = user_id);

grant select on public.ai_usage_logs to authenticated;

-- Keep plan capabilities consistent with the account tier.
update public.profiles
set
  vision_enabled = (plan in ('pro','legendary') or role = 'owner'),
  memory_enabled = (plan in ('pro','legendary') or role = 'owner'),
  web_search_enabled = (plan = 'legendary' or role = 'owner')
where true;
