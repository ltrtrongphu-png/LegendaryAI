import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const MODEL_ALIASES: Record<string, { envUrl: string; envKey: string; envModel: string; provider: "openai" | "anthropic" }> = {
  "legendary-6": { envUrl: "AI_API_URL", envKey: "AI_API_KEY", envModel: "AI_MODEL", provider: "openai" },
  "custom": { envUrl: "CUSTOM_AI_API_URL", envKey: "CUSTOM_AI_API_KEY", envModel: "CUSTOM_AI_MODEL", provider: "openai" },
};

const SYSTEM_DEFAULT = `You are Legendary-6, the reasoning core of LegendaryAI.

Operating principles:
- Understand the user's intent before answering.
- For technical work, inspect constraints, identify edge cases, and provide working code.
- Do not fabricate facts, APIs, benchmarks, test results, or completed actions.
- When information is uncertain or time-sensitive, say so and ask for or use a reliable source.
- Prefer concise, structured answers with concrete steps.
- Keep track of conversation context and avoid repeating questions already answered.
- For code, preserve existing project conventions and explain breaking changes briefly.
- Separate verified facts, assumptions, and recommendations.
- Refuse unsafe requests and offer safe alternatives.
- When asked to improve software, prioritize correctness, security, maintainability, and UX.`;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

async function hmacSafeCompare(a: string, b: string): Promise<boolean> {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, { global: { headers: { Authorization: auth } } });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await supabase.from("profiles").select("plan,token_limit,tokens_used,token_reset_at").eq("id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const body = await req.json().catch(() => ({}));
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json({ error: "messages is required" }, 400);

  const modelKey = typeof body.model === "string" && MODEL_ALIASES[body.model] ? body.model : "legendary-6";
  const alias = MODEL_ALIASES[modelKey];
  const apiUrl = Deno.env.get(alias.envUrl);
  const apiKey = Deno.env.get(alias.envKey);
  const model = Deno.env.get(alias.envModel);

  if (!apiUrl || !apiKey || !model || model.startsWith("YOUR_")) {
    return json({ error: "AI backend chưa được cấu hình. Thiết lập AI_API_URL, AI_API_KEY và AI_MODEL trên Edge Function." }, 503);
  }

  const lastUser = [...messages].reverse().find((m) => m && m.role === "user");
  const inputText = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content || "");
  const estimatedInput = estimateTokens(inputText);
  const reserve = Math.min(Math.max(estimatedInput + 1024, 2048), 8192);

  const { data: allowed, error: tokenError } = await supabase.rpc("consume_tokens", { p_amount: reserve });
  if (tokenError) return json({ error: tokenError.message }, 500);
  if (!allowed) return json({
    error: "Bạn đã chạm hạn mức token. Hãy chờ reset hoặc nâng gói.",
    code: "TOKEN_LIMIT",
    tokenLimit: profile.token_limit,
    tokensUsed: profile.tokens_used,
  }, 429);

  const system = typeof body.system === "string" && body.system.trim() ? body.system.trim() : SYSTEM_DEFAULT;
  const maxTokens = Math.min(Number(body.max_tokens) || 4096, 8192);
  const providerMessages = [{ role: "system", content: system }, ...messages.map((m: any) => ({
    role: m.role === "ai" ? "assistant" : m.role,
    content: m.content ?? m.text ?? "",
  }))];

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + apiKey,
  };

  const payload = {
    model,
    messages: providerMessages,
    temperature: typeof body.temperature === "number" ? Math.max(0, Math.min(body.temperature, 1.2)) : 0.35,
    max_tokens: maxTokens,
    stream: false,
  };

  const response = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return json({
      error: data?.error?.message || data?.message || "Model backend error",
      providerStatus: response.status,
    }, 502);
  }

  let text = "";
  if (Array.isArray(data?.choices) && data.choices[0]?.message?.content) {
    text = String(data.choices[0].message.content);
  } else if (Array.isArray(data?.content)) {
    text = data.content.map((x: any) => x?.text || "").join("");
  } else if (typeof data?.output_text === "string") {
    text = data.output_text;
  }

  if (!text) return json({ error: "Model returned an empty response." }, 502);

  const actualEstimate = estimateTokens(text);
  if (actualEstimate < reserve) {
    // Refund unused reservation. The current SQL function intentionally only debits,
    // so a future billing ledger can reconcile exact provider usage.
  }

  return json({
    model: modelKey,
    providerModel: model,
    text,
    usage: data?.usage || { estimated_input_tokens: estimatedInput, estimated_output_tokens: actualEstimate },
  });
});
