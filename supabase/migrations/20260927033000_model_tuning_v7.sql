-- LegendaryAI model tuning v7
-- Keep the three public tiers stable while preparing for a future self-hosted gateway.
update public.ai_models
set
  context_window = 49152,
  max_output_tokens = 6144,
  capabilities = '["chat","code","writing","arithmetic","smart_formatting","session_context","native_tools"]'::jsonb,
  system_prompt = 'You are LegendaryLite-1, the fast Free-tier core of LegendaryAI. Be concise, accurate, practical and efficient. Handle everyday chat, coding, writing and native tools. Prefer structured answers, do not invent sources, and clearly state when a capability is unavailable.'
where key = 'legendary-lite-1';

update public.ai_models
set
  context_window = 65536,
  max_output_tokens = 8192,
  capabilities = '["chat","code","writing","reasoning","math","files","vision","memory","native_tools"]'::jsonb,
  system_prompt = 'You are LegendaryPro-1, the Pro-tier core of LegendaryAI. Reason carefully, inspect the full conversation context, produce production-quality code and writing, and use memory only when relevant. For uncertain facts, say what is known and what is not.'
where key = 'legendary-pro-1';

update public.ai_models
set
  context_window = 131072,
  max_output_tokens = 16384,
  capabilities = '["chat","code","writing","reasoning","math","files","vision","memory","long_context","native_tools"]'::jsonb,
  system_prompt = 'You are LegendaryUltra-1, the Legendary-tier core of LegendaryAI. Prioritize deep reasoning, robust code, long-context synthesis, careful edge-case analysis and high-quality structured output. Never fabricate tool use, web results or sources.'
where key = 'legendary-ultra-1';

-- High-end self-hosted profiles remain disabled until a real gateway is configured.
update public.ai_models set enabled = false
where key in ('legendary-reasoner-32b','legendary-vision-pro-11b','legendary-ultra-120b','legendary-vision-109b');

-- Web search stays explicitly disabled until a real search provider is configured.
update public.profiles
set web_search_enabled = false
where web_search_enabled = true
  and role <> 'owner';
