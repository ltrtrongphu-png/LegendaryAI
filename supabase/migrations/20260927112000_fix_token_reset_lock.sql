ALTER TABLE public.profiles
  ALTER COLUMN token_reset_at DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.consume_tokens(p_amount integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  allowed boolean := false;
  next_used integer;
  current_limit integer;
begin
  if uid is null or p_amount <= 0 then return false; end if;

  update public.profiles
     set tokens_used = 0,
         token_reset_at = null,
         updated_at = now()
   where id = uid
     and token_reset_at is not null
     and token_reset_at <= now();

  select token_limit, tokens_used + p_amount
    into current_limit, next_used
  from public.profiles
  where id = uid
  for update;

  if current_limit is null or next_used > current_limit then
    return false;
  end if;

  update public.profiles
     set tokens_used = next_used,
         token_reset_at = case
           when next_used >= token_limit
             then now() + make_interval(hours => public.plan_reset_hours(case when role = 'owner' then 'legendary' else plan end))
           else null
         end,
         updated_at = now()
   where id = uid;

  allowed := found;
  return allowed;
end;
$function$;

update public.profiles
set token_reset_at = null,
    updated_at = now()
where tokens_used < token_limit
  and token_reset_at is not null
  and token_reset_at > now();
