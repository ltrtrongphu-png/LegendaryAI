-- Keep manual resets consistent with the plan reset window.
create or replace function public.manual_reset_tokens(p_user_id uuid)
returns table(success boolean,message text,tokens_used integer,token_limit integer,token_reset_at timestamptz,reset_available_at timestamptz)
language plpgsql
security definer
set search_path=''
as $$
declare
  uid uuid := p_user_id;
  p public.profiles%rowtype;
  cooldown interval;
  window_start timestamptz;
  reset_hours integer;
  next_reset timestamptz;
begin
  if uid is null then
    return query select false,'Unauthorized',0,0,null::timestamptz,null::timestamptz;
    return;
  end if;

  select * into p from public.profiles where id=uid for update;
  if not found then
    return query select false,'Profile not found',0,0,null::timestamptz,null::timestamptz;
    return;
  end if;

  if p.role='owner' or p.plan='legendary' then
    cooldown := interval '7 days';
  elsif p.plan='pro' then
    cooldown := interval '1 month';
  else
    return query select false,'Tính năng reset token chỉ dành cho Pro và Legendary.',p.tokens_used,p.token_limit,p.token_reset_at,null::timestamptz;
    return;
  end if;

  select greatest(coalesce(pl.reset_hours,6),1)
    into reset_hours
    from public.plans pl
   where pl.id=p.plan_id or pl.key=p.plan
   order by (pl.id=p.plan_id) desc
   limit 1;

  reset_hours := greatest(coalesce(reset_hours,6),1);
  window_start := p.token_reset_window_started_at;
  if window_start is null or window_start+cooldown<=now() then
    window_start := now();
    p.token_reset_uses := 0;
  end if;

  if p.token_reset_uses>=1 then
    return query select false,'Bạn đã dùng lượt reset trong chu kỳ hiện tại.',p.tokens_used,p.token_limit,p.token_reset_at,window_start+cooldown;
    return;
  end if;

  next_reset := now()+make_interval(hours=>reset_hours);
  update public.profiles
     set tokens_used=0,
         token_reset_at=next_reset,
         token_reset_uses=p.token_reset_uses+1,
         token_reset_window_started_at=window_start,
         updated_at=now()
   where id=uid;

  return query select true,'Token đã được reset.',0,p.token_limit,next_reset,window_start+cooldown;
end;
$$;

revoke all on function public.manual_reset_tokens(uuid) from public,anon,authenticated;
grant execute on function public.manual_reset_tokens(uuid) to service_role;

-- A message must belong to a conversation owned by the same user.
drop policy if exists "messages own rows" on public.messages;
create policy "messages own rows" on public.messages
for all to anon, authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and c.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and c.user_id = (select auth.uid())
  )
);
