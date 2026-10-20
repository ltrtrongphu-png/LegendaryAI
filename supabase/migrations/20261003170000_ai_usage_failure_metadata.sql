alter table public.ai_usage_logs
  add column if not exists error_code text,
  add column if not exists error_message text;

create index if not exists ai_usage_logs_status_created_idx
  on public.ai_usage_logs(status, created_at desc);

create index if not exists ai_usage_logs_user_created_idx
  on public.ai_usage_logs(user_id, created_at desc);
