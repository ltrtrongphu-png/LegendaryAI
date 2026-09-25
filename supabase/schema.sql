-- LegendaryAI production schema
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free','pro','legendary')),
  token_limit integer not null default 250000,
  tokens_used integer not null default 0,
  token_reset_at timestamptz not null default (now() + interval '1 day'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
create policy "profiles own row" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

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
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

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
