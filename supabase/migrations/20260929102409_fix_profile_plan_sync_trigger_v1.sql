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