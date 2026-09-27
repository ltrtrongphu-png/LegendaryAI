import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = new Set([
  "https://legendaryai.vercel.app",
  "https://www.legendaryai.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const CORS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Expose-Headers": "content-type",
  "Vary": "Origin",
};

function headers(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    ...CORS,
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://legendaryai.vercel.app",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers(req) },
  });
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((x: any) => {
      if (typeof x === "string") return x;
      if (x?.type === "text") return x.text || "";
      if (x?.type === "image") return "[Hình ảnh đính kèm: " + String(x.name || "image") + "]";
      return x?.text || x?.content || "";
    }).join("\n");
  }
  return value == null ? "" : JSON.stringify(value);
}

function estimateTokens(s: string) {
  return Math.max(1, Math.ceil(String(s || "").length / 4));
}

function modelFor(plan: string) {
  if (plan === "legendary") return "legendary-ultra-1";
  if (plan === "pro") return "legendary-pro-1";
  return "legendary-lite-1";
}

function modelTierAllowed(plan: string, role: string, requestedTier: string) {
  // Plans can use their own model tier or any lower tier.
  // Owner/Legendary can access all normal tiers.
  if (role === "owner") return ["free", "pro", "legendary"].includes(requestedTier);
  if (plan === "legendary") return ["free", "pro", "legendary"].includes(requestedTier);
  if (plan === "pro") return ["free", "pro"].includes(requestedTier);
  return requestedTier === "free";
}

function safeMath(input: string): number | null {
  const s = String(input || "").trim().replace(/,/g, ".");
  if (!s || !/^[0-9+\-*/%(). x×÷]+$/i.test(s)) return null;
  const expr = s.replace(/[x×]/gi, "*").replace(/÷/g, "/");
  if (!/[0-9]/.test(expr)) return null;
  try {
    const value = Function("\"use strict\"; return (" + expr + ")")();
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function nativeAnswer(model: string, messages: any[]) {
  const last = [...messages].reverse().find((m: any) => m?.role === "user");
  const prompt = textOf(last?.content).trim();
  if (!prompt) return "Mình đã sẵn sàng. Hãy gửi yêu cầu cụ thể.";

  const mathInput = prompt.replace(/^(tính|calculate|calc|calculator)[: ]*/i, "").trim();
  const math = safeMath(mathInput);
  if (math !== null && /[+\-*/%×÷]/.test(mathInput)) {
    return "## Kết quả\n\n**" + math + "**\n\nĐược tính bằng core toán học nội bộ của LegendaryAI.";
  }

  if (/^(hi|hello|xin chào|chào|hey)\b/i.test(prompt)) {
    return "Xin chào! 👋 **Legendary Engine đang online.**\n\nModel: **" + model + "**\nChế độ: Native Legendary Core.";
  }

  if (/(code|javascript|typescript|python|sql|supabase|bug|debug|lỗi|error|api)/i.test(prompt)) {
    return "## Legendary Code Reasoning\n\nMình đã nhận yêu cầu:\n\n> " + prompt +
      "\n\n### Quy trình\n- Kiểm tra input và state.\n- Kiểm tra request/response và authentication.\n- Kiểm tra log backend.\n- Đưa ra bản sửa nhỏ, an toàn trước khi thay đổi lớn.\n\n**Model:** " + model;
  }

  if (/(tóm tắt|summarize|summary)/i.test(prompt)) {
    const recent = messages.slice(-8).map((m: any) => textOf(m.content)).filter(Boolean).join("\n");
    return "## Tóm tắt\n\n" + recent.slice(-5000);
  }

  if (/(viết lại|rewrite|dịch|translate|email|soạn)/i.test(prompt)) {
    return "## Legendary Writing Mode\n\nĐã nhận yêu cầu:\n\n> " + prompt +
      "\n\nMình có thể xử lý tiếp dựa trên nội dung/context bạn cung cấp.";
  }

  return "## Legendary Engine\n\nMình đã nhận:\n\n> " + prompt +
    "\n\nNative core đang hoạt động với context của phiên chat.\n\n**Model:** " + model;
}

async function ollama(baseUrl: string, model: string, messages: any[], system: string, maxTokens: number, temperature: number) {
  const base = baseUrl.replace(/\/$/, "");
  const payload = {
    model,
    stream: false,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...messages.map((m: any) => ({ role: m.role, content: m.content })),
    ],
    options: { temperature, num_predict: maxTokens },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error("Local AI gateway HTTP " + response.status + ": " + raw.slice(0, 500));
    const data = JSON.parse(raw);
    return String(data?.message?.content || data?.response || "").trim();
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json(req, { error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(req, { error: "Server configuration missing", code: "SERVER_CONFIG" }, 503);

  const supabase = createClient(supabaseUrl, serviceKey, { global: { headers: { Authorization: auth } } });
  const authResult = await supabase.auth.getUser();
  if (authResult.error || !authResult.data.user) return json(req, { error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON", code: "INVALID_JSON" }, 400); }

  const messages = Array.isArray(body?.messages) ? body.messages.slice(-80) : [];
  if (!messages.length) return json(req, { error: "messages is required", code: "MESSAGES_REQUIRED" }, 400);

  const user = authResult.data.user;
  let { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,plan,token_limit,tokens_used,token_reset_at,memory_enabled,vision_enabled")
    .eq("id", user.id)
    .maybeSingle();

  // Self-heal accounts created before the profile trigger was installed, or
  // accounts where the trigger failed. This prevents a valid authenticated
  // user from getting stuck at "Profile not found".
  if (!profile && !profileError) {
    const email = String(user.email || "").trim().toLowerCase();
    const isOwner = email === "ltrtrongphu@gmail.com";
    const { error: createProfileError } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        display_name: user.user_metadata?.full_name || user.user_metadata?.name || (email ? email.split("@")[0] : "Legendary User"),
        avatar_url: user.user_metadata?.avatar_url || null,
        role: isOwner ? "owner" : "user",
        plan: isOwner ? "legendary" : "free",
        token_limit: isOwner ? 6000000 : 150000,
        memory_enabled: isOwner,
        vision_enabled: isOwner,
        web_search_enabled: isOwner,
      });

    if (!createProfileError) {
      const refreshed = await supabase
        .from("profiles")
        .select("role,plan,token_limit,tokens_used,token_reset_at,memory_enabled,vision_enabled")
        .eq("id", user.id)
        .maybeSingle();
      profile = refreshed.data;
      profileError = refreshed.error;
    } else if (createProfileError.code === "23505") {
      // A concurrent request may have created the row between our read and insert.
      const refreshed = await supabase
        .from("profiles")
        .select("role,plan,token_limit,tokens_used,token_reset_at,memory_enabled,vision_enabled")
        .eq("id", user.id)
        .maybeSingle();
      profile = refreshed.data;
      profileError = refreshed.error;
    } else {
      profileError = createProfileError;
    }
  }

  if (profileError || !profile) {
    return json(req, {
      error: "Profile could not be loaded or created",
      code: "PROFILE_NOT_FOUND",
      details: profileError?.message || null,
    }, 500);
  }

  const plan = String(profile.plan || "free");
  const role = String(profile.role || "user");
  const requestedModel = typeof body?.model === "string" ? body.model.trim() : "auto";

  // "auto" keeps the plan's default. A specific model is allowed only when
  // its tier is at or below the user's entitlement.
  let modelKey = modelFor(plan);
  if (requestedModel && requestedModel !== "auto") {
    const { data: requested } = await supabase
      .from("ai_models")
      .select("key,tier,enabled")
      .eq("key", requestedModel)
      .eq("enabled", true)
      .maybeSingle();

    if (!requested) {
      return json(req, {
        error: "Model không tồn tại hoặc đang tắt.",
        code: "MODEL_NOT_AVAILABLE"
      }, 400);
    }

    if (requested.tier === "system") {
      if (role !== "owner") {
        return json(req, {
          error: "Model này chỉ dành cho Owner.",
          code: "MODEL_FORBIDDEN"
        }, 403);
      }
    } else if (!modelTierAllowed(plan, role, requested.tier)) {
      return json(req, {
        error: "Model này không thuộc quyền của gói hiện tại.",
        code: "MODEL_FORBIDDEN"
      }, 403);
    }

    modelKey = requested.key;
  }

  const { data: model } = await supabase
    .from("ai_models")
    .select("key,display_name,tier,provider,model_id,max_output_tokens,capabilities,system_prompt,enabled")
    .eq("key", modelKey)
    .eq("enabled", true)
    .maybeSingle();

  if (!model) return json(req, { error: "Legendary model is not configured", code: "MODEL_NOT_CONFIGURED" }, 503);

  const inputText = messages.map((m: any) => textOf(m.content)).join("\n");
  const inputTokens = estimateTokens(inputText);
  const maxTokens = Math.min(
    Math.max(Number(body?.max_tokens) || Number(model.max_output_tokens) || 8192, 256),
    Number(model.max_output_tokens) || 8192
  );
  const reservation = Math.max(1, Math.min(inputTokens + maxTokens, Number(profile.token_limit || 150000)));

  const { data: allowed, error: tokenError } = await supabase.rpc("consume_tokens", { p_amount: reservation });
  if (tokenError) return json(req, { error: tokenError.message, code: "TOKEN_RPC_ERROR" }, 500);
  if (!allowed) {
    return json(req, {
      error: "Bạn đã chạm hạn mức token của gói hiện tại.",
      code: "TOKEN_LIMIT",
      tokenLimit: Number(profile.token_limit || 0),
      tokensUsed: Number(profile.tokens_used || 0),
      tokenResetAt: profile.token_reset_at,
    }, 429);
  }

  try {
    const system = typeof body?.system === "string" && body.system.trim() ? body.system.trim() : String(model.system_prompt || "");
    const gateway = Deno.env.get("LEGENDARY_LOCAL_AI_URL") || "";
    let answer = "";

    if (gateway && model.provider === "ollama-compatible" && model.model_id) {
      answer = await ollama(gateway, model.model_id, messages, system, maxTokens, Number(body?.temperature ?? 0.35));
    } else {
      answer = nativeAnswer(model.display_name || modelKey, messages);
    }

    if (!answer) answer = nativeAnswer(model.display_name || modelKey, messages);

    const outputTokens = estimateTokens(answer);
    const actual = inputTokens + outputTokens;

    // The reservation is made up-front by consume_tokens(). Refund the unused
    // part instead of depending on a second finalize_tokens RPC that may not
    // exist on older Supabase projects.
    if (reservation > actual) {
      await supabase.rpc("refund_tokens", { p_amount: reservation - actual });
    }

    const { data: latestProfile } = await supabase
      .from("profiles")
      .select("token_limit,tokens_used,token_reset_at")
      .eq("id", user.id)
      .maybeSingle();

    const state = latestProfile || {
      token_limit: profile.token_limit,
      tokens_used: Number(profile.tokens_used || 0) + actual,
      token_reset_at: profile.token_reset_at,
    };

    await supabase.from("ai_usage_logs").insert({
      user_id: user.id,
      model_key: model.key,
      provider_model: model.model_id,
      plan,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      reserved_tokens: reservation,
      request_ms: 0,
      status: "success",
    });

    return json(req, {
      model: model.key,
      displayModel: model.display_name || modelKey,
      providerModel: model.model_id,
      tier: model.tier,
      capabilities: Array.isArray(model.capabilities) ? model.capabilities : [],
      fallbackUsed: false,
      local: true,
      native: true,
      text: answer,
      plan,
      brain: {
        version: "8.0",
        intent: "general",
        tool: null,
        route: model.key,
        memory: Boolean(profile.memory_enabled),
        tools: { arithmetic: true, summarizer: true, translator: true, structured_output: true, planning: true, code_review: true, calculator: true, web_search: false, vision: Boolean(profile.vision_enabled), self_hosted_models: Boolean(gateway) },
      },
      usage: {
        estimated_input_tokens: inputTokens,
        estimated_output_tokens: outputTokens,
        actual_tokens: actual,
        reserved_tokens: reservation,
        tokens_used: Number(state?.tokens_used ?? Number(profile.tokens_used || 0) + actual),
        tokens_remaining: Number(state?.tokens_remaining ?? Math.max(Number(profile.token_limit || 0) - Number(profile.tokens_used || 0) - actual, 0)),
        token_limit: Number(state?.token_limit ?? profile.token_limit),
        token_reset_at: state?.token_reset_at ?? profile.token_reset_at ?? null,
      },
    }, 200);
  } catch (error) {
    await supabase.rpc("refund_tokens", { p_amount: reservation }).catch(() => null);
    return json(req, { error: error instanceof Error ? error.message : "Legendary Engine failed", code: "LEGENDARY_ENGINE_ERROR" }, 500);
  }
});
