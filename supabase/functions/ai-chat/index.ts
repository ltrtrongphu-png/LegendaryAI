import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const configuredSiteUrl = (Deno.env.get("SITE_URL") || "*").replace(/\/$/, "");
const corsHeaders = {
  "Access-Control-Allow-Origin": configuredSiteUrl,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const MODEL_BY_PLAN: Record<string, string> = {
  free: "legendary-lite-1",
  pro: "legendary-pro-1",
  legendary: "legendary-ultra-1",
};

const SYSTEM_DEFAULT = `You are LegendaryAI, a high-reliability general AI assistant.

Operating principles:
- Understand intent before answering.
- Reason carefully; never invent facts, APIs, benchmarks, sources, or completed actions.
- For software tasks, produce secure, maintainable, production-oriented code.
- Preserve relevant conversation context and avoid unnecessary repetition.
- Distinguish verified facts, assumptions, and uncertainty.
- Be concise by default and expand when depth is needed.
- Use tools or external data only when actually available.
- Refuse unsafe requests and provide safe alternatives.`;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function tierAllowed(role: string, plan: string, tier: string): boolean {
  if (role === "owner") return true;
  if (tier === "free") return true;
  if (tier === "pro") return plan === "pro" || plan === "legendary";
  if (tier === "legendary") return plan === "legendary";
  return false;
}

function extractModelText(data: any): string {
  if (Array.isArray(data?.choices) && data.choices[0]?.message?.content) {
    const content = data.choices[0].message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((part: any) => typeof part === "string" ? part : part?.text || "").join("");
    }
  }
  if (typeof data?.choices?.[0]?.text === "string") return data.choices[0].text;
  if (Array.isArray(data?.content)) {
    return data.content.map((part: any) => part?.text || "").join("");
  }
  if (typeof data?.output_text === "string") return data.output_text;
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase server configuration is missing." }, 503);

  const supabase = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: auth } },
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,plan,token_limit,tokens_used,token_reset_at,memory_enabled,vision_enabled,web_search_enabled")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) return json({ error: "Profile not found." }, 404);

  const requestStarted = Date.now();
  const body = await req.json().catch(() => ({}));
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json({ error: "messages is required" }, 400);

  const requested = typeof body.model === "string" ? body.model.trim() : "";
  const requestedKey = requested && requested !== "auto"
    ? requested
    : (MODEL_BY_PLAN[profile.plan] || MODEL_BY_PLAN.free);

  const { data: requestedModel } = await supabase
    .from("ai_models")
    .select("key,display_name,tier,provider,model_id,base_url,base_url_env,api_key_env,context_window,max_output_tokens,capabilities,system_prompt,enabled")
    .eq("key", requestedKey)
    .eq("enabled", true)
    .maybeSingle();

  let selectedModel = requestedModel;
  let fallbackUsed = false;

  if (!selectedModel || !tierAllowed(profile.role, profile.plan, selectedModel.tier)) {
    const entitledKey = MODEL_BY_PLAN[profile.plan] || MODEL_BY_PLAN.free;
    const { data: fallback } = await supabase
      .from("ai_models")
      .select("key,display_name,tier,provider,model_id,base_url,base_url_env,api_key_env,context_window,max_output_tokens,capabilities,system_prompt,enabled")
      .eq("key", entitledKey)
      .eq("enabled", true)
      .maybeSingle();
    selectedModel = fallback;
    fallbackUsed = true;
  }

  if (!selectedModel) return json({ error: "No model is configured for this account tier." }, 503);

  const capabilities = Array.isArray(selectedModel.capabilities) ? selectedModel.capabilities : [];
  const apiUrl = selectedModel.base_url || Deno.env.get(selectedModel.base_url_env || "") || "";
  const apiKey = Deno.env.get(selectedModel.api_key_env || "") || Deno.env.get("AI_API_KEY") || "";
  const modelId = selectedModel.model_id;

  if (!apiUrl || !apiKey || !modelId || modelId.startsWith("YOUR_")) {
    return json({
      error: "AI model backend chưa được cấu hình.",
      model: selectedModel.display_name,
      required: [selectedModel.base_url_env, selectedModel.api_key_env],
    }, 503);
  }

  const lastUser = [...messages].reverse().find((m: any) => m && m.role === "user");
  const lastUserText = typeof lastUser?.content === "string"
    ? lastUser.content
    : JSON.stringify(lastUser?.content || "");

  const estimatedInputTokens = estimateTokens(lastUserText);
  const requestedOutput = Number(body.max_tokens) || selectedModel.max_output_tokens || 4096;
  const maxTokens = Math.min(
    Math.max(256, requestedOutput),
    Number(selectedModel.max_output_tokens || 4096),
  );
  const reservation = Math.min(estimatedInputTokens + maxTokens, 20000);

  const { data: allowed, error: tokenError } = await supabase.rpc("consume_tokens", { p_amount: reservation });
  if (tokenError) return json({ error: tokenError.message }, 500);
  if (!allowed) {
    return json({
      error: "Bạn đã chạm hạn mức token của gói hiện tại. Hãy chờ reset hoặc nâng gói.",
      code: "TOKEN_LIMIT",
      tokenLimit: profile.token_limit,
      tokensUsed: profile.tokens_used,
      model: selectedModel.display_name,
    }, 429);
  }

  const system =
    (typeof body.system === "string" && body.system.trim())
      ? body.system.trim()
      : (selectedModel.system_prompt || SYSTEM_DEFAULT);

  let memoryContext = "";
  if (profile.memory_enabled) {
    const { data: memories } = await supabase
      .from("ai_memories")
      .select("memory,importance")
      .eq("user_id", user.id)
      .order("importance", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(12);
    if (memories?.length) {
      memoryContext = "\nRelevant user memory (use only when applicable):\n" +
        memories.map((m: any) => "- " + String(m.memory)).join("\n");
    }
  }

  const featureContext = [
    `Enabled capabilities: ${capabilities.join(", ") || "chat"}.`,
    profile.memory_enabled ? "User memory is enabled; preserve useful long-term preferences supplied by the backend." : "",
    profile.vision_enabled ? "Vision is enabled for this account tier." : "",
    profile.web_search_enabled ? "Web search is enabled when a backend tool is available." : "",
    memoryContext,
  ].filter(Boolean).join(" ");

  const normalizedMessages = messages.map((m: any) => ({
    role: m.role === "ai" ? "assistant" : m.role,
    content: m.content ?? m.text ?? "",
  }));

  const hasVisionInput = normalizedMessages.some((m: any) =>
    Array.isArray(m.content) && m.content.some((part: any) => part?.type === "image_url" || part?.type === "image")
  );
  if (hasVisionInput && !profile.vision_enabled) {
    await supabase.rpc("refund_tokens", { p_amount: reservation });
    return json({
      error: "Vision không khả dụng với gói hiện tại. Hãy nâng lên Pro hoặc Legendary.",
      code: "VISION_NOT_AVAILABLE",
      model: selectedModel.display_name,
    }, 403);
  }

  const providerMessages = [
    { role: "system", content: system + "\n\n" + featureContext },
    ...normalizedMessages,
  ];

  const payload = {
    model: modelId,
    messages: providerMessages,
    temperature: typeof body.temperature === "number"
      ? Math.max(0, Math.min(body.temperature, 1.2))
      : 0.35,
    max_tokens: maxTokens,
    stream: false,
  };

  const providerHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + apiKey,
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: providerHeaders,
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    await supabase.rpc("refund_tokens", { p_amount: reservation });
    await supabase.from("ai_usage_logs").insert({
      user_id: user.id,
      model_key: selectedModel.key,
      provider_model: modelId,
      plan: profile.plan,
      reserved_tokens: reservation,
      request_ms: Date.now() - requestStarted,
      status: "error",
    });
    return json({
      error: data?.error?.message || data?.message || "Model provider error",
      providerStatus: response.status,
      model: selectedModel.display_name,
    }, 502);
  }

  const text = extractModelText(data);

  if (!text.trim()) {
    await supabase.rpc("refund_tokens", { p_amount: reservation });
    await supabase.from("ai_usage_logs").insert({
      user_id: user.id,
      model_key: selectedModel.key,
      provider_model: modelId,
      plan: profile.plan,
      reserved_tokens: reservation,
      request_ms: Date.now() - requestStarted,
      status: "error",
    });
    return json({ error: "Model returned an empty response." }, 502);
  }

  await supabase.from("ai_usage_logs").insert({
    user_id: user.id,
    model_key: selectedModel.key,
    provider_model: modelId,
    plan: profile.plan,
    input_tokens: Number(data?.usage?.prompt_tokens || data?.usage?.input_tokens || estimatedInputTokens),
    output_tokens: Number(data?.usage?.completion_tokens || data?.usage?.output_tokens || estimateTokens(text)),
    reserved_tokens: reservation,
    request_ms: Date.now() - requestStarted,
    status: "success",
  });

  return json({
    model: selectedModel.key,
    displayModel: selectedModel.display_name,
    providerModel: modelId,
    tier: selectedModel.tier,
    capabilities,
    fallbackUsed,
    text,
    usage: data?.usage || {
      estimated_input_tokens: estimatedInputTokens,
      estimated_output_tokens: estimateTokens(text),
      reserved_tokens: reservation,
    },
  });
});
