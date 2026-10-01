alter table public.ai_models drop constraint if exists ai_models_provider_check;
alter table public.ai_models add constraint ai_models_provider_check check (provider in ('local','ollama-compatible','huggingface-space','openai-compatible','anthropic-compatible'));

alter table public.ai_models add column if not exists health_status text not null default 'unknown';
alter table public.ai_models add column if not exists last_health_check_at timestamptz;
alter table public.ai_models add column if not exists last_latency_ms integer;
alter table public.ai_models add column if not exists failure_count integer not null default 0;
alter table public.ai_models add column if not exists priority integer not null default 0;
alter table public.ai_models add column if not exists supports_streaming boolean not null default false;
alter table public.ai_models add column if not exists supports_vision boolean not null default false;
alter table public.ai_models add column if not exists supports_tools boolean not null default false;
alter table public.ai_models add column if not exists supports_json boolean not null default false;
alter table public.ai_models add column if not exists supports_system_prompt boolean not null default true;

alter table public.ai_models drop constraint if exists ai_models_health_status_check;
alter table public.ai_models add constraint ai_models_health_status_check check (health_status in ('unknown','checking','ready','degraded','offline'));

create index if not exists ai_models_provider_priority_idx on public.ai_models(provider, priority desc, enabled);

-- A future Hugging Face Space profile can be inserted/enabled without changing the chat UI.
-- Keep it disabled until the Space protocol and smoke test are verified.
insert into public.ai_models
(key,display_name,tier,provider,model_id,base_url_env,api_key_env,context_window,max_output_tokens,capabilities,system_prompt,enabled,health_status,priority,supports_streaming,supports_vision,supports_tools,supports_json,supports_system_prompt)
values
('legendary-hf-local-1','Legendary HF Local 1','free','huggingface-space','CHANGE_ME','HF_SPACE_URL','HF_TOKEN',32768,4096,
 '["chat","code","writing","arithmetic","session_context"]'::jsonb,
 'You are the real local model behind LegendaryAI. Return only the final user-facing answer and never claim capabilities you did not use.',
 false,'unknown',100,false,false,false,false,true)
on conflict (key) do nothing;
