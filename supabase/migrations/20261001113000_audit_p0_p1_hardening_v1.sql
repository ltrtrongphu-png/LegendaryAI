-- LegendaryAI audit hardening: token RPCs, dynamic plan keys, paid-plan expiry,
-- atomic MoMo finalization, and safe owner bootstrap.
-- Production changes were applied before this file was committed.

alter table public.profiles
  add column if not exists plan_expires_at timestamptz;

alter table public.orders
  add column if not exists expires_at timestamptz;

update public.profiles p
set plan_id = pl.id
from public.plans pl
where p.plan_id is null and pl.key = p.plan;

alter table public.profiles
  alter column plan_id set not null;

alter table public.profiles
  drop constraint if exists profiles_plan_check;

alter table public.profiles
  drop constraint if exists profiles_plan_key_fkey;

alter table public.profiles
  add constraint profiles_plan_key_fkey
  foreign key (plan) references public.plans(key)
  on update cascade on delete restrict;

alter table public.orders
  drop constraint if exists orders_plan_check;

alter table public.orders
  drop constraint if exists orders_plan_key_fkey;

alter table public.orders
  add constraint orders_plan_key_fkey
  foreign key (plan) references public.plans(key)
  on update cascade on delete restrict;

create index if not exists profiles_plan_expires_idx
  on public.profiles(plan, plan_expires_at)
  where plan_expires_at is not null;

create index if not exists orders_expires_idx
  on public.orders(expires_at)
  where expires_at is not null;
create index if not exists profiles_plan_id_idx on public.profiles(plan_id);
create index if not exists orders_plan_idx on public.orders(plan);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id, display_name, avatar_url, role, plan, plan_id, token_limit,
    memory_enabled, vision_enabled, web_search_enabled
  )
  select
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url',
    'user',
    pl.key,
    pl.id,
    pl.token_limit,
    coalesce((pl.capabilities->>'memory')::boolean, false),
    coalesce((pl.capabilities->>'vision')::boolean, false),
    coalesce((pl.capabilities->>'webSearch')::boolean, false)
  from public.plans pl
  where pl.key = 'free'
  limit 1
  on conflict (id) do update set
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

drop function if exists public.manual_reset_tokens();

create or replace function public.manual_reset_tokens(p_user_id uuid)
returns table(success boolean,message text,tokens_used integer,token_limit integer,token_reset_at timestamptz,reset_available_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := p_user_id;
  p public.profiles%rowtype;
  cooldown interval;
  window_start timestamptz;
begin
  if uid is null then
    return query select false,'Unauthorized',0,0,null::timestamptz,null::timestamptz;
    return;
  end if;
  select * into p from public.profiles where id=uid for update;
  if p.role='owner' or p.plan='legendary' then cooldown:=interval '7 days';
  elsif p.plan='pro' then cooldown:=interval '1 month';
  else
    return query select false,'Tính năng reset token chỉ dành cho Pro và Legendary.',p.tokens_used,p.token_limit,p.token_reset_at,null::timestamptz;
    return;
  end if;
  window_start:=p.token_reset_window_started_at;
  if window_start is null or window_start+cooldown<=now() then
    window_start:=now();
    p.token_reset_uses:=0;
  end if;
  if p.token_reset_uses>=1 then
    return query select false,'Bạn đã dùng lượt reset trong chu kỳ hiện tại.',p.tokens_used,p.token_limit,p.token_reset_at,window_start+cooldown;
    return;
  end if;
  update public.profiles
  set tokens_used=0,token_reset_at=null,token_reset_uses=p.token_reset_uses+1,
      token_reset_window_started_at=window_start,updated_at=now()
  where id=uid;
  return query select true,'Token đã được reset.',0,p.token_limit,null::timestamptz,window_start+cooldown;
end;
$$;

revoke all on function public.manual_reset_tokens(uuid) from public,anon,authenticated;
grant execute on function public.manual_reset_tokens(uuid) to service_role;

revoke all on function public.finalize_tokens(integer,integer) from public,anon,authenticated;

create or replace function public.finalize_momo_payment(
  p_order_id uuid,p_success boolean,p_result_code integer,p_message text,p_paid_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  pl public.plans%rowtype;
  expires_at_value timestamptz;
  base_expiry timestamptz;
begin
  select * into o from public.orders where id=p_order_id for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.status='paid' then
    return jsonb_build_object('ok',true,'already_processed',true,'order_id',o.id);
  end if;

  if not p_success then
    update public.orders set status='failed',provider_result_code=p_result_code,
      provider_message=left(coalesce(p_message,''),1000),updated_at=now() where id=o.id;
    return jsonb_build_object('ok',true,'paid',false,'order_id',o.id);
  end if;

  select * into pl from public.plans where key=o.plan;
  if pl.id is null then raise exception 'Plan configuration not found'; end if;

  base_expiry:=case
    when pl.billing_period='year' then now()+interval '1 year'
    when pl.billing_period='month' then now()+interval '1 month'
    when pl.billing_period='week' then now()+interval '1 week'
    when pl.billing_period='day' then now()+interval '1 day'
    else null end;

  select case
    when p.plan_expires_at is not null and p.plan_expires_at>now() then
      case
        when pl.billing_period='year' then p.plan_expires_at+interval '1 year'
        when pl.billing_period='month' then p.plan_expires_at+interval '1 month'
        when pl.billing_period='week' then p.plan_expires_at+interval '1 week'
        when pl.billing_period='day' then p.plan_expires_at+interval '1 day'
        else base_expiry
      end
    else base_expiry
  end
  into expires_at_value
  from public.profiles p where p.id=o.user_id for update;

  if expires_at_value is null then raise exception 'Unsupported billing period'; end if;

  update public.orders
  set status='paid',provider_result_code=p_result_code,
      provider_message=left(coalesce(p_message,''),1000),
      paid_at=coalesce(p_paid_at,now()),expires_at=expires_at_value,updated_at=now()
  where id=o.id;

  update public.profiles
  set plan=pl.key,plan_id=pl.id,token_limit=pl.token_limit,
      memory_enabled=coalesce((pl.capabilities->>'memory')::boolean,false),
      vision_enabled=coalesce((pl.capabilities->>'vision')::boolean,false),
      web_search_enabled=coalesce((pl.capabilities->>'webSearch')::boolean,false),
      tokens_used=0,
      token_reset_at=now()+make_interval(hours=>greatest(pl.reset_hours,1)),
      plan_expires_at=expires_at_value,updated_at=now()
  where id=o.user_id;

  return jsonb_build_object('ok',true,'paid',true,'already_processed',false,
    'order_id',o.id,'plan',pl.key,'expires_at',expires_at_value);
end;
$$;

revoke all on function public.finalize_momo_payment(uuid,boolean,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.finalize_momo_payment(uuid,boolean,integer,text,timestamptz) to service_role;
