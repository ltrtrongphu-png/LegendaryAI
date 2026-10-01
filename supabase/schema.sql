-- LegendaryAI production schema
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  role text not null default 'user' check (role in ('user','admin','owner')),
  plan text not null default 'free' check (plan in ('free','pro','legendary')),
  token_limit integer not null default 500000,
  memory_enabled boolean not null default false,
  vision_enabled boolean not null default false,
  web_search_enabled boolean not null default false,
  tokens_used integer not null default 0,
  token_reset_at timestamptz not null default (now() + interval '6 hours'),
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
  slug text,
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
create unique index if not exists conversations_user_slug_uidx
  on public.conversations(user_id, slug) where slug is not null;
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
as $$
declare new_role text := 'user';
begin
  if lower(coalesce(new.email, '')) = 'ltrtrongphu@gmail.com' then
    new_role := 'owner';
  end if;

  insert into public.profiles (id, display_name, avatar_url, role, memory_enabled, vision_enabled, web_search_enabled)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    new_role,
    false,
    new_role = 'owner',
    new_role = 'owner'
  )
  on conflict (id) do update set
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);

  return new;
end;
$$;

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
create or replace function public.consume_tokens(p_amount integer, p_user_id uuid, p_is_guest boolean default false)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := coalesce(p_user_id, auth.uid());
  caller_uid uuid := auth.uid();
  allowed boolean;
  next_reset timestamptz;
begin
  if uid is null or p_amount <= 0 then return false; end if;
  if caller_uid is not null and caller_uid <> uid then return false; end if;
  select case
    when p_is_guest then token_reset_at
    when plan = 'legendary' or role = 'owner' then now() + interval '18 hours'
    when plan = 'pro' then now() + interval '12 hours'
    else now() + interval '6 hours'
  end into next_reset
  from public.profiles where id = uid;
  update public.profiles
     set tokens_used = case
       when p_is_guest then tokens_used + p_amount
       when token_reset_at <= now() then p_amount
       else tokens_used + p_amount
     end,
     token_reset_at = case
       when p_is_guest then token_reset_at
       when token_reset_at <= now() then next_reset
       else token_reset_at
     end,
     updated_at = now()
   where id = uid
     and case
       when p_is_guest then tokens_used + p_amount <= least(token_limit, 1000)
       when token_reset_at <= now() then p_amount <= token_limit
       else tokens_used + p_amount <= token_limit
     end
   returning true into allowed;
  return coalesce(allowed, false);
end;
$$;

revoke all on function public.consume_tokens(integer, uuid, boolean) from public;
grant execute on function public.consume_tokens(integer, uuid, boolean) to service_role;

-- Optional model registry for Owner-controlled model profiles.
create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  display_name text not null,
  tier text not null default 'free' check (tier in ('free','pro','legendary','system')),
  provider text not null check (provider in ('local','openai-compatible','anthropic-compatible')),
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

alter table public.ai_models drop constraint if exists ai_models_provider_check;
alter table public.ai_models add constraint ai_models_provider_check check (provider in ('local','ollama-compatible','openai-compatible','anthropic-compatible'));
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
  (key, display_name, tier, provider, model_id, base_url_env, api_key_env, context_window, max_output_tokens, capabilities, system_prompt, enabled)
values
(
  'legendary-lite-1','LegendaryLite-1','free','local','legendary-lite-local',null,null,49152,6144,
  '["chat","code","writing","arithmetic","smart_formatting","session_context"]'::jsonb,
  'You are LegendaryLite-1, the fast Free-tier assistant of LegendaryAI. Be concise, accurate, practical, structured, and efficient. Use the conversation context aggressively, solve basic arithmetic reliably, help with everyday code and writing, and never invent external sources.',true
),
(
  'legendary-pro-1','LegendaryPro-1','pro','local','legendary-pro-local',null,null,65536,8192,
  '["chat","code","writing","files","vision","memory"]'::jsonb,
  'You are LegendaryPro-1, the Pro-tier assistant of LegendaryAI. Reason carefully and preserve context.',true
),
(
  'legendary-ultra-1','LegendaryUltra-1','legendary','local','legendary-ultra-local',null,null,131072,16384,
  '["chat","code","writing","files","vision","memory","web_search","tools"]'::jsonb,
  'You are LegendaryUltra-1, the highest-tier assistant of LegendaryAI. Prioritize deep reasoning, robust code and long-context synthesis.',true
),
(
  'custom','Custom Model','system','local','legendary-custom-local',null,null,131072,16384,
  '["chat","code","writing","files","vision","memory","tools"]'::jsonb,
  'You are a custom model integrated into LegendaryAI. Follow system instructions precisely.',true
),
(
  'legendary-reasoner-32b','Legendary Reasoner 32B','pro','ollama-compatible','qwen3:30b','LEGENDARY_LOCAL_AI_URL',null,131072,16384,
  '["chat","code","reasoning","math","writing","tools"]'::jsonb,
  'Native Legendary reasoning profile backed by a self-hosted Qwen3-class model.',false
),
(
  'legendary-vision-pro-11b','Legendary Vision Pro 11B','pro','ollama-compatible','llama3.2-vision:11b','LEGENDARY_LOCAL_AI_URL',null,131072,8192,
  '["chat","vision","files","ocr","image_reasoning","memory"]'::jsonb,
  'Native Pro multimodal profile backed by a self-hosted Llama 3.2 Vision 11B model.',false
),
(
  'legendary-ultra-120b','Legendary Ultra 120B','legendary','ollama-compatible','gpt-oss:120b','LEGENDARY_LOCAL_AI_URL',null,131072,32768,
  '["chat","code","reasoning","math","writing","vision","tools","memory"]'::jsonb,
  'Native Legendary high-end reasoning profile backed by a self-hosted open-weight model.',false
),
(
  'legendary-vision-109b','Legendary Vision 109B','legendary','ollama-compatible','llama4:scout','LEGENDARY_LOCAL_AI_URL',null,1048576,16384,
  '["chat","code","vision","files","reasoning","multimodal","memory"]'::jsonb,
  'Native Legendary multimodal profile backed by a self-hosted Llama 4-class model.',false
)
on conflict (key) do update set
  display_name=excluded.display_name,
  tier=excluded.tier,
  provider=excluded.provider,
  model_id=excluded.model_id,
  base_url_env=excluded.base_url_env,
  api_key_env=excluded.api_key_env,
  context_window=excluded.context_window,
  max_output_tokens=excluded.max_output_tokens,
  capabilities=excluded.capabilities,
  system_prompt=excluded.system_prompt,
  enabled=excluded.enabled,
  updated_at=now();

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
  token_limit = case
    when role = 'owner' then greatest(token_limit, 6000000)
    when plan = 'legendary' then 6000000
    when plan = 'pro' then 2000000
    else 500000
  end,
  vision_enabled = (plan in ('pro','legendary') or role = 'owner'),
  memory_enabled = (plan in ('pro','legendary') or role = 'owner'),
  web_search_enabled = (plan = 'legendary' or role = 'owner')
where true;


create or replace function public.refund_tokens(p_amount integer, p_user_id uuid)
returns boolean
language plpgsql
security definer set search_path = ''
as $
declare
  uid uuid := coalesce(p_user_id, auth.uid());
  caller_uid uuid := auth.uid();
begin
  if uid is null or p_amount <= 0 then return false; end if;
  if caller_uid is not null and caller_uid <> uid then return false; end if;
  update public.profiles
     set tokens_used = greatest(tokens_used - p_amount, 0), updated_at = now()
   where id = uid;
  return found;
end;
$;

revoke all on function public.refund_tokens(integer, uuid) from public, anon, authenticated;
grant execute on function public.refund_tokens(integer, uuid) to service_role;

-- Was missing entirely: supabase/functions/ai-chat/index.ts calls this after
-- every successful reply to true the reservation made by consume_tokens()
-- down to the actual tokens used. Without it, every request permanently
-- keeps the full pessimistic reservation (input + max_tokens, e.g. 4096+)
-- charged against tokens_used even though the real reply used far less --
-- draining the account's budget after a fraction of the messages it should
-- actually allow, and eventually causing spurious TOKEN_LIMIT errors.
create or replace function public.finalize_tokens(p_reserved integer, p_actual integer)
returns table (
  tokens_used integer,
  tokens_remaining integer,
  token_limit integer,
  token_reset_at timestamptz
)
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  delta integer := coalesce(p_actual, 0) - coalesce(p_reserved, 0);
begin
  if uid is null then
    return;
  end if;

  return query
  update public.profiles p
     set tokens_used = greatest(p.tokens_used + delta, 0),
         updated_at = now()
   where p.id = uid
  returning
    p.tokens_used,
    greatest(p.token_limit - p.tokens_used, 0),
    p.token_limit,
    p.token_reset_at;
end;
$$;

revoke all on function public.finalize_tokens(integer, integer) from public, anon, authenticated;


-- Dynamic plan baseline. This section makes schema.sql self-contained and safe to rerun
-- after the earlier legacy profile/order definitions above.
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  price_vnd bigint not null default 0 check (price_vnd >= 0),
  billing_period text not null default 'month',
  token_limit integer not null check (token_limit > 0),
  reset_hours integer not null default 6 check (reset_hours > 0),
  reasoning_tier text not null default 'basic',
  default_model_key text,
  model_tiers jsonb not null default '[\"free\"]'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  features jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.plans
  (key,name,description,price_vnd,billing_period,token_limit,reset_hours,reasoning_tier,default_model_key,model_tiers,capabilities,features,enabled,priority)
values
  ('guest','Khách','Phiên khách giới hạn',0,'session',1000,6,'none','legendary-lite-1','["free"]'::jsonb,'{"reasoning":false,"projectWorkspace":false,"vision":false,"memory":false,"agentMode":false,"batchTasks":false,"multiModel":false}'::jsonb,'["Dùng thử Native Core","1.000 token"]'::jsonb,false,-1),
  ('free','Gói Free','Gói miễn phí cho nhu cầu cơ bản',0,'month',500000,6,'basic','legendary-lite-1','["free"]'::jsonb,'{"reasoning":true,"projectWorkspace":false,"vision":false,"memory":false,"agentMode":false,"batchTasks":false,"multiModel":false}'::jsonb,'["500.000 token / 6 giờ","LegendaryLite-1","Chat & coding cơ bản"]'::jsonb,true,10),
  ('pro','Gói Pro','Gói chuyên sâu hằng ngày',149000,'month',2000000,12,'deep','legendary-pro-1','["free","pro"]'::jsonb,'{"reasoning":true,"projectWorkspace":true,"vision":true,"memory":true,"agentMode":false,"batchTasks":true,"multiModel":false}'::jsonb,'["2.000.000 token / 12 giờ","Reasoning","Vision","Memory","Batch tasks"]'::jsonb,true,20),
  ('legendary','Gói Legendary','Gói workload lớn và model cao cấp',399000,'month',6000000,18,'deep-plus','legendary-ultra-1','["free","pro","legendary"]'::jsonb,'{"reasoning":true,"projectWorkspace":true,"vision":true,"memory":true,"agentMode":true,"batchTasks":true,"multiModel":true}'::jsonb,'["6.000.000 token / 18 giờ","Advanced Memory","Agent","Multi-model"]'::jsonb,true,30)
on conflict (key) do update set
  name=excluded.name,description=excluded.description,price_vnd=excluded.price_vnd,
  billing_period=excluded.billing_period,token_limit=excluded.token_limit,
  reset_hours=excluded.reset_hours,reasoning_tier=excluded.reasoning_tier,
  default_model_key=excluded.default_model_key,model_tiers=excluded.model_tiers,
  capabilities=excluded.capabilities,features=excluded.features,
  enabled=excluded.enabled,priority=excluded.priority,updated_at=now();

alter table public.profiles add column if not exists plan_id uuid;
alter table public.profiles add column if not exists plan_expires_at timestamptz;
alter table public.orders add column if not exists expires_at timestamptz;

update public.profiles p
set plan_id=pl.id
from public.plans pl
where p.plan_id is null and pl.key=coalesce(nullif(p.plan,''),'free');

alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles drop constraint if exists profiles_plan_key_fkey;
alter table public.profiles add constraint profiles_plan_key_fkey
  foreign key (plan) references public.plans(key) on update cascade on delete restrict;

alter table public.orders drop constraint if exists orders_plan_check;
alter table public.orders drop constraint if exists orders_plan_key_fkey;
alter table public.orders add constraint orders_plan_key_fkey
  foreign key (plan) references public.plans(key) on update cascade on delete restrict;

create index if not exists profiles_plan_id_idx on public.profiles(plan_id);
create index if not exists orders_plan_idx on public.orders(plan);

alter table public.plans enable row level security;
drop policy if exists "plans_public_read_enabled" on public.plans;
create policy "plans_public_read_enabled" on public.plans
  for select to anon, authenticated using (enabled=true);
drop policy if exists "plans_owner_read_all" on public.plans;
create policy "plans_owner_read_all" on public.plans
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='owner')
  );
revoke insert, update, delete on public.plans from anon, authenticated;
grant select on public.plans to anon, authenticated, service_role;
grant insert, update, delete on public.plans to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id,display_name,avatar_url,role,plan,plan_id,token_limit,memory_enabled,vision_enabled,web_search_enabled)
  select new.id,
    coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name',split_part(coalesce(new.email,''),'@',1)),
    new.raw_user_meta_data->>'avatar_url','user',pl.key,pl.id,pl.token_limit,
    coalesce((pl.capabilities->>'memory')::boolean,false),
    coalesce((pl.capabilities->>'vision')::boolean,false),
    coalesce((pl.capabilities->>'webSearch')::boolean,false)
  from public.plans pl where pl.key='free' limit 1
  on conflict (id) do update set
    display_name=coalesce(excluded.display_name,public.profiles.display_name),
    avatar_url=coalesce(excluded.avatar_url,public.profiles.avatar_url),
    updated_at=now();
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public,anon,authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

drop function if exists public.manual_reset_tokens();

create or replace function public.manual_reset_tokens(p_user_id uuid)
returns table(success boolean,message text,tokens_used integer,token_limit integer,token_reset_at timestamptz,reset_available_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare uid uuid:=p_user_id; p public.profiles%rowtype; cooldown interval; window_start timestamptz;
begin
  if uid is null then return query select false,'Unauthorized',0,0,null::timestamptz,null::timestamptz; return; end if;
  select * into p from public.profiles where id=uid for update;
  if p.role='owner' or p.plan='legendary' then cooldown:=interval '7 days';
  elsif p.plan='pro' then cooldown:=interval '1 month';
  else return query select false,'Tính năng reset token chỉ dành cho Pro và Legendary.',p.tokens_used,p.token_limit,p.token_reset_at,null::timestamptz; return; end if;
  window_start:=p.token_reset_window_started_at;
  if window_start is null or window_start+cooldown<=now() then window_start:=now(); p.token_reset_uses:=0; end if;
  if p.token_reset_uses>=1 then return query select false,'Bạn đã dùng lượt reset trong chu kỳ hiện tại.',p.tokens_used,p.token_limit,p.token_reset_at,window_start+cooldown; return; end if;
  update public.profiles set tokens_used=0,token_reset_at=null,token_reset_uses=p.token_reset_uses+1,token_reset_window_started_at=window_start,updated_at=now() where id=uid;
  return query select true,'Token đã được reset.',0,p.token_limit,null::timestamptz,window_start+cooldown;
end;
$$;
revoke all on function public.manual_reset_tokens(uuid) from public,anon,authenticated;
grant execute on function public.manual_reset_tokens(uuid) to service_role;

revoke all on function public.finalize_tokens(integer,integer) from public,anon,authenticated;
