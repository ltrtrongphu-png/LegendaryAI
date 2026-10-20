create index if not exists conversations_user_updated_idx on public.conversations (user_id, updated_at desc);
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);

create or replace function public.sync_conversation(
  p_id text,
  p_user_id uuid,
  p_title text,
  p_slug text,
  p_created_at timestamptz,
  p_updated_at timestamptz,
  p_messages jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_updated timestamptz;
  message_ids text[];
  accepted boolean := false;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select updated_at into current_updated
  from public.conversations
  where id = p_id and user_id = p_user_id
  for update;

  if current_updated is null or p_updated_at >= current_updated then
    insert into public.conversations (id, user_id, title, slug, created_at, updated_at)
    values (p_id, p_user_id, left(coalesce(p_title, 'Cuộc trò chuyện mới'), 200), nullif(p_slug, ''), coalesce(p_created_at, now()), p_updated_at)
    on conflict (id) do update set
      title = excluded.title,
      slug = excluded.slug,
      updated_at = excluded.updated_at
    where public.conversations.user_id = p_user_id
      and excluded.updated_at >= public.conversations.updated_at;

    select array_agg(x.id)
      into message_ids
    from jsonb_to_recordset(coalesce(p_messages, '[]'::jsonb)) as x(id text, conversation_id text, user_id uuid, role text, content text, attachments jsonb, created_at timestamptz);

    delete from public.messages m
    where m.conversation_id = p_id
      and m.user_id = p_user_id
      and (message_ids is null or not (m.id = any(message_ids)));

    insert into public.messages (id, conversation_id, user_id, role, content, attachments, created_at)
    select x.id, p_id, p_user_id, x.role, coalesce(x.content, ''), coalesce(x.attachments, '[]'::jsonb), coalesce(x.created_at, now())
    from jsonb_to_recordset(coalesce(p_messages, '[]'::jsonb)) as x(id text, conversation_id text, user_id uuid, role text, content text, attachments jsonb, created_at timestamptz)
    on conflict (id) do update set
      conversation_id = excluded.conversation_id,
      user_id = excluded.user_id,
      role = excluded.role,
      content = excluded.content,
      attachments = excluded.attachments,
      created_at = excluded.created_at
    where public.messages.user_id = p_user_id and public.messages.conversation_id = p_id;

    accepted := true;
  end if;

  return jsonb_build_object('accepted', accepted, 'updated_at', coalesce((select updated_at from public.conversations where id = p_id and user_id = p_user_id), current_updated));
end;
$$;

revoke execute on function public.sync_conversation(text, uuid, text, text, timestamptz, timestamptz, jsonb) from public, anon;
grant execute on function public.sync_conversation(text, uuid, text, text, timestamptz, timestamptz, jsonb) to authenticated;
