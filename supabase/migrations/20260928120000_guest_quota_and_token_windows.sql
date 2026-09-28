-- Guest quota + plan-aware token windows
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
  end into next_reset from public.profiles where id = uid;
  update public.profiles
  set tokens_used = case when p_is_guest then tokens_used + p_amount when token_reset_at <= now() then p_amount else tokens_used + p_amount end,
      token_reset_at = case when p_is_guest then token_reset_at when token_reset_at <= now() then next_reset else token_reset_at end,
      updated_at = now()
  where id = uid
    and case when p_is_guest then tokens_used + p_amount <= least(token_limit,1000)
             when token_reset_at <= now() then p_amount <= token_limit
             else tokens_used + p_amount <= token_limit end
  returning true into allowed;
  return coalesce(allowed,false);
end;
$$;
drop function if exists public.consume_tokens(integer,uuid);
revoke all on function public.consume_tokens(integer,uuid,boolean) from public;
grant execute on function public.consume_tokens(integer,uuid,boolean) to service_role;
update public.profiles set token_reset_at=case when role='owner' or plan='legendary' then now()+interval '18 hours' when plan='pro' then now()+interval '12 hours' else now()+interval '6 hours' end where token_reset_at is null or token_reset_at<=now();
