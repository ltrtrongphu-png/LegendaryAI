create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  price_vnd bigint not null default 0 check (price_vnd >= 0),
  billing_period text not null default 'month' check (billing_period in ('day','week','month','year','session')),
  token_limit integer not null check (token_limit > 0),
  reset_hours integer not null default 6 check (reset_hours > 0),
  reasoning_tier text not null default 'basic',
  default_model_key text,
  model_tiers jsonb not null default '["free"]'::jsonb,
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
  name=excluded.name, description=excluded.description, price_vnd=excluded.price_vnd,
  billing_period=excluded.billing_period, token_limit=excluded.token_limit,
  reset_hours=excluded.reset_hours, reasoning_tier=excluded.reasoning_tier,
  default_model_key=excluded.default_model_key, model_tiers=excluded.model_tiers,
  capabilities=excluded.capabilities, features=excluded.features,
  updated_at=now();

alter table public.profiles add column if not exists plan_id uuid;

update public.profiles p set plan_id=pl.id
from public.plans pl
where pl.key=coalesce(nullif(p.plan,''),'free') and p.plan_id is distinct from pl.id;

alter table public.profiles drop constraint if exists profiles_plan_id_fkey;
alter table public.profiles add constraint profiles_plan_id_fkey foreign key (plan_id) references public.plans(id) on delete restrict;

alter table public.plans enable row level security;
drop policy if exists "plans_public_read_enabled" on public.plans;
drop policy if exists "plans_owner_read_all" on public.plans;
drop policy if exists "plans_read" on public.plans;
create policy "plans_read" on public.plans for select to anon, authenticated using (
  enabled=true or exists (
    select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='owner'
  )
);
revoke insert, update, delete on public.plans from anon, authenticated;
grant select on public.plans to anon, authenticated, service_role;
grant insert, update, delete on public.plans to service_role;

create or replace function public.sync_profile_plan_fields()
returns trigger language plpgsql security definer set search_path=''
as $$
declare target_plan public.plans%rowtype;
begin
  if new.plan_id is null then
    select * into target_plan from public.plans where key=coalesce(nullif(new.plan,''),'free') limit 1;
    if target_plan.id is not null then new.plan_id:=target_plan.id; end if;
  elsif tg_op='INSERT' or new.plan_id is distinct from old.plan_id then
    select * into target_plan from public.plans where id=new.plan_id limit 1;
    if target_plan.id is not null then new.plan:=target_plan.key; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_profile_plan_fields on public.profiles;
create trigger trg_sync_profile_plan_fields before insert or update of plan,plan_id on public.profiles
for each row execute function public.sync_profile_plan_fields();

create or replace function public.consume_tokens(p_amount integer,p_user_id uuid,p_is_guest boolean default false)
returns boolean language plpgsql security definer set search_path=''
as $$
declare uid uuid:=coalesce(p_user_id,auth.uid()); caller_uid uuid:=auth.uid(); next_reset timestamptz; effective_limit integer; reset_hours integer; allowed boolean;
begin
  if uid is null or p_amount<=0 then return false; end if;
  if caller_uid is not null and caller_uid<>uid then return false; end if;
  select p.token_limit,p.reset_hours into effective_limit,reset_hours from public.profiles p left join public.plans pl on pl.id=p.plan_id
  where p.id=uid;
  if effective_limit is null then return false; end if;
  next_reset:=now()+make_interval(hours=>greatest(coalesce(reset_hours,6),1));
  update public.profiles set tokens_used=case when p_is_guest then tokens_used+p_amount when token_reset_at<=now() then p_amount else tokens_used+p_amount end,
    token_reset_at=case when p_is_guest then token_reset_at when token_reset_at<=now() then next_reset else token_reset_at end,updated_at=now()
  where id=uid and case when p_is_guest then tokens_used+p_amount<=least(effective_limit,1000) when token_reset_at<=now() then p_amount<=effective_limit else tokens_used+p_amount<=effective_limit end
  returning true into allowed;
  return coalesce(allowed,false);
end;
$$;

create or replace function public.refund_tokens(p_amount integer,p_user_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare uid uuid:=coalesce(p_user_id,auth.uid()); caller_uid uuid:=auth.uid();
begin
  if uid is null or p_amount<=0 then return false; end if;
  if caller_uid is not null and caller_uid<>uid then return false; end if;
  update public.profiles set tokens_used=greatest(0,tokens_used-p_amount),updated_at=now() where id=uid;
  return found;
end;
$$;

revoke execute on function public.consume_tokens(integer,uuid,boolean) from public,anon,authenticated;
revoke execute on function public.refund_tokens(integer,uuid) from public,anon,authenticated;
grant execute on function public.consume_tokens(integer,uuid,boolean) to service_role;
grant execute on function public.refund_tokens(integer,uuid) to service_role;