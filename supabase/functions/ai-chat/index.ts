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


function localModelResponse(modelKey: string, messages: any[], system: string): string {
  const userMessages = messages.filter((m: any) => m?.role === "user");
  const latest = userMessages[userMessages.length - 1]?.content;
  const prompt = typeof latest === "string"
    ? latest.trim()
    : JSON.stringify(latest || "");
  const context = userMessages.slice(-5).map((m: any) => String(m.content || "")).join("\n");
  const lower = prompt.toLowerCase();

  const modelName =
    modelKey === "legendary-ultra-1" ? "LegendaryUltra-1" :
    modelKey === "legendary-pro-1" ? "LegendaryPro-1" :
    modelKey === "custom" ? "Legendary Custom" : "LegendaryLite-1";

  if (/^(xin chào|chào|hello|hi|hey)\b/i.test(prompt)) {
    return `Xin chào! Mình là **${modelName}**, đang chạy ở **Local Sandbox Mode** của LegendaryAI.\\n\\nHiện tại mình không gọi Claude, ChatGPT hay bất kỳ API AI bên ngoài nào. Bạn có thể dùng mình để kiểm tra giao diện, auth, hội thoại, token quota và luồng backend trước khi gắn model thật.`;
  }

  if (/(debug|code|lập trình|javascript|typescript|python|java|c#|minecraft|plugin|yaml|sql)/i.test(prompt)) {
    return `## Phân tích yêu cầu

Bạn đang yêu cầu xử lý một tác vụ kỹ thuật:

> ${prompt}

Ở **Local Sandbox Mode**, mình không có foundation model bên ngoài để thực hiện suy luận sâu hoặc chạy code thật. Tuy nhiên gateway đã nhận đúng request và model profile **${modelName}** đã được chọn.

**Context gần đây:** ${context.slice(-800) || "không có"}

Khi bạn gắn model backend thật sau này, cùng request này sẽ được chuyển qua Legendary Engine mà không cần thay frontend.`;
  }

  if (/(tính|calculate|calculate|bao nhiêu|phương trình|\d+\s*[+\-*/]\s*\d+)/i.test(prompt)) {
    return `Mình đã nhận yêu cầu tính toán: **${prompt}**.

Local Sandbox hiện ưu tiên kiểm thử pipeline hơn là đóng vai một LLM đầy đủ. Với phép tính đơn giản, frontend/backend vẫn có thể kiểm tra request → quota → model → response mà không cần API key bên ngoài.`;
  }

  if (/(viết|soạn|email|bài|content|tài liệu|rewrite|dịch|translate)/i.test(prompt)) {
    return `Mình đã nhận yêu cầu viết:

> ${prompt}

**Chế độ hiện tại:** ${modelName} · Local Sandbox

Chế độ này chưa sử dụng Claude/ChatGPT và chưa có foundation model thật, nên phản hồi được tạo bởi lớp mô phỏng của Legendary Engine. Hệ thống vẫn lưu context, quota và usage như luồng AI thật.`;
  }

  return `Đã nhận: **${prompt || "(tin nhắn trống)"}**

LegendaryAI đang chạy **${modelName} · Local Sandbox Mode**. Không có Claude API, không có OpenAI/ChatGPT API và không cần AI provider API key.

Bạn có thể dùng chế độ này để kiểm tra:
- đăng nhập / Owner
- nhiều cuộc trò chuyện
- token quota
- model routing theo gói
- memory
- usage log
- Supabase Edge Function

Foundation model thật có thể được gắn vào cùng gateway sau này mà không cần đổi giao diện.`;
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
  const modelId = selectedModel.model_id;

  const system =
    (typeof body.system === "string" && body.system.trim())
      ? body.system.trim()
      : (selectedModel.system_prompt || SYSTEM_DEFAULT);

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

  if (selectedModel.provider === "local") {
    const text = localModelResponse(selectedModel.key, messages, system + memoryContext);
    const estimatedOutputTokens = estimateTokens(text);
    await supabase.from("ai_usage_logs").insert({
      user_id: user.id,
      model_key: selectedModel.key,
      provider_model: modelId,
      plan: profile.plan,
      input_tokens: estimatedInputTokens,
      output_tokens: estimatedOutputTokens,
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
      local: true,
      text,
      usage: {
        estimated_input_tokens: estimatedInputTokens,
        estimated_output_tokens: estimatedOutputTokens,
        reserved_tokens: reservation,
      },
    });
  }

  return json({
    error: "External AI providers are disabled in the current LegendaryAI sandbox. Use a local model profile.",
    code: "EXTERNAL_AI_DISABLED",
    model: selectedModel.display_name,
  }, 503);

});
