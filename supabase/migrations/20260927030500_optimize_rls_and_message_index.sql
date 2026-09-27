create index if not exists messages_user_id_idx on public.messages(user_id);

drop policy if exists "profiles own select" on public.profiles;
create policy "profiles own select" on public.profiles for select using ((select auth.uid()) = id);

drop policy if exists "conversations own rows" on public.conversations;
create policy "conversations own rows" on public.conversations for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "messages own rows" on public.messages;
create policy "messages own rows" on public.messages for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "orders own rows" on public.orders;
create policy "orders own rows" on public.orders for select using ((select auth.uid()) = user_id);

drop policy if exists "ai memories own rows" on public.ai_memories;
create policy "ai memories own rows" on public.ai_memories for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "ai usage own read" on public.ai_usage_logs;
create policy "ai usage own read" on public.ai_usage_logs for select using ((select auth.uid()) = user_id);

drop policy if exists "ai models public enabled read" on public.ai_models;
create policy "ai models public enabled read" on public.ai_models for select using (enabled = true or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'));

drop policy if exists "ai models owner write" on public.ai_models;
drop policy if exists "ai models owner insert" on public.ai_models;
drop policy if exists "ai models owner update" on public.ai_models;
drop policy if exists "ai models owner delete" on public.ai_models;
create policy "ai models owner insert" on public.ai_models for insert with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'));
create policy "ai models owner update" on public.ai_models for update using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner')) with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'));
create policy "ai models owner delete" on public.ai_models for delete using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'));

drop policy if exists "chat attachments own read" on storage.objects;
create policy "chat attachments own read" on storage.objects for select using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "chat attachments own insert" on storage.objects;
create policy "chat attachments own insert" on storage.objects for insert with check (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "chat attachments own delete" on storage.objects;
create policy "chat attachments own delete" on storage.objects for delete using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);