-- Fix Edge Functions using the service-role client: auth.uid() is NULL there.
-- Keep direct authenticated calls scoped to their own auth.uid(), while allowing
-- the trusted Edge Function service-role client to pass the authenticated user id.

create or replace function public.consume_tokens(p_amount integer, p_user_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := coalesce(p_user_id, auth.uid());
  caller_uid uuid := auth.uid();
  allowed boolean;
begin
  if p_amount is null or p_amount <= 0 or uid is null then return false; end if;
  if caller_uid is not null and caller_uid <> uid then return false; end if;
  update public.profiles
  set tokens_used = case when token_reset_at <= now() then p_amount else tokens_used + p_amount end,
      token_reset_at = case when token_reset_at <= now() then now() + interval '1 day' else token_reset_at end,
      updated_at = now()
  where id = uid
    and case when token_reset_at <= now() then p_amount <= token_limit else tokens_used + p_amount <= token_limit end
  returning true into allowed;
  return coalesce(allowed, false);
end;
$$;

create or replace function public.refund_tokens(p_amount integer, p_user_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := coalesce(p_user_id, auth.uid());
  caller_uid uuid := auth.uid();
begin
  if p_amount is null or p_amount <= 0 or uid is null then return false; end if;
  if caller_uid is not null and caller_uid <> uid then return false; end if;
  update public.profiles set tokens_used = greatest(0, tokens_used - p_amount), updated_at = now() where id = uid;
  return found;
end;
$$;

revoke all on function public.consume_tokens(integer) from public;
revoke all on function public.consume_tokens(integer, uuid) from public;
revoke all on function public.refund_tokens(integer) from public;
revoke all on function public.refund_tokens(integer, uuid) from public;
grant execute on function public.consume_tokens(integer, uuid) to authenticated;
grant execute on function public.consume_tokens(integer, uuid) to service_role;
grant execute on function public.refund_tokens(integer, uuid) to authenticated;
grant execute on function public.refund_tokens(integer, uuid) to service_role;
