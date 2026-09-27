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


function detectIntent(prompt: string): string {
  const p = String(prompt || "").trim().toLowerCase();
  if (/^(hi|hello|xin chào|chào|hey)\b/.test(p)) return "greeting";
  if (/(tính|calculate|calculator|calc)\b|^\s*[0-9][0-9+\-*/%(). x×÷]*$/.test(p)) return "math";
  if (/(tóm tắt|tóm lược|summarize|summary|rút ra.*ý chính)/.test(p)) return "summarize";
  if (/(dịch|translate|translation)\b/.test(p)) return "translate";
  if (/(viết lại|rewrite|paraphrase|chỉnh sửa|sửa câu)/.test(p)) return "rewrite";
  if (/(debug|bug|lỗi|error|fix|sửa code|code review|review code)/.test(p) ||
      /\b(javascript|typescript|python|java|c\+\+|c#|sql|supabase|api|html|css)\b/.test(p)) return "code";
  if (/(kế hoạch|plan|roadmap|lộ trình|từng bước|steps)/.test(p)) return "plan";
  if (/(so sánh|compare|khác nhau|difference|ưu.*nhược|trade.?off)/.test(p)) return "compare";
  if (/(giải thích|explain|tại sao|why|how does|là gì|what is)/.test(p)) return "explain";
  if (/(ý tưởng|brainstorm|gợi ý|ideas|đề xuất)/.test(p)) return "brainstorm";
  return "general";
}

function extractRecentContext(messages: any[], maxChars = 7000): string {
  const items = messages.slice(-10).map((m: any) => {
    const role = m?.role === "assistant" || m?.role === "ai" ? "AI" : "User";
    return role + ": " + textOf(m?.content);
  }).filter(Boolean).join("\n");
  return items.slice(-maxChars);
}

function firstSentences(text: string, count: number): string[] {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?。！？])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, count);
}

function nativeAnswer(model: string, messages: any[], system = "") {
  const last = [...messages].reverse().find((m: any) => m?.role === "user");
  const prompt = textOf(last?.content).trim();
  if (!prompt) return "Mình đã sẵn sàng. Hãy gửi yêu cầu cụ thể.";

  const intent = detectIntent(prompt);
  const context = extractRecentContext(messages);
  const attachmentHint = messages.some((m: any) => Array.isArray(m?.content) && m.content.some((x: any) => x?.type === "image"))
    ? "\n\n> Có hình ảnh trong ngữ cảnh; Native Core hiện chỉ nhận metadata ảnh, chưa có vision model thật."
    : "";

  const mathInput = prompt.replace(/^(tính|calculate|calc|calculator)[: ]*/i, "").trim();
  const math = safeMath(mathInput);
  if (intent === "math" && math !== null) {
    return "## Kết quả\n\n**" + math + "**\n\n**Cách xử lý:** biểu thức được kiểm tra bằng core toán học nội bộ của LegendaryAI.\n\n**Model:** " + model;
  }

  if (intent === "greeting") {
    return "Xin chào! 👋 **Legendary Engine đang online.**\n\nMình có thể tự nhận diện yêu cầu để chọn luồng xử lý cho **code, toán, tóm tắt, viết lại, lập kế hoạch, so sánh và giải thích**.\n\n**Model:** " + model;
  }

  if (intent === "summarize") {
    const source = context || prompt;
    const sentences = firstSentences(source.replace(/^User:\s*/gm, ""), 6);
    const bullets = sentences.length
      ? sentences.map(s => "- " + s).join("\n")
      : "- Chưa có đủ nội dung để tóm tắt.";
    return "## Tóm tắt thông minh\n\n" + bullets +
      "\n\n### Trọng tâm\n- Xác định chủ đề từ ngữ cảnh gần nhất.\n- Ưu tiên thông tin mới và nội dung người dùng vừa cung cấp.\n- Không tự thêm dữ kiện không có trong ngữ cảnh.\n\n**Intent:** summarize · **Model:** " + model;
  }

  if (intent === "code") {
    const codeSignals: string[] = [];
    const source = context;
    if (/\bTODO\b/i.test(source)) codeSignals.push("Có TODO/comment cần hoàn thiện.");
    if (/\bconsole\.log\b/i.test(source)) codeSignals.push("Có console.log — nên loại bỏ hoặc thay bằng logging phù hợp trước production.");
    if (/innerHTML\s*=/.test(source)) codeSignals.push("Có innerHTML — cần kiểm tra dữ liệu đầu vào để tránh XSS.");
    if (/fetch\s*\(/.test(source) && !/catch\s*\(|\.catch\s*\(/.test(source)) codeSignals.push("Có fetch nhưng chưa thấy nhánh catch rõ ràng trong context hiện tại.");
    if (/password|secret|api[_-]?key|service[_-]?role/i.test(source)) codeSignals.push("Có dấu hiệu dữ liệu bí mật — không nên đưa secret vào frontend hoặc commit.");
    return "## Legendary Code Reasoning\n\n**Yêu cầu:** " + prompt +
      "\n\n### Cách phân tích\n1. Xác định triệu chứng và phạm vi lỗi.\n2. Đọc context/tệp gần nhất trước khi kết luận.\n3. Kiểm tra dữ liệu, state, async flow và quyền truy cập.\n4. Đề xuất bản sửa nhỏ, có thể kiểm thử.\n\n" +
      (codeSignals.length ? "### Tín hiệu phát hiện\n" + codeSignals.map(x => "- " + x).join("\n") : "### Tín hiệu phát hiện\n- Chưa thấy mẫu lỗi phổ biến trong context hiện tại.") +
      "\n\n**Intent:** code · **Model:** " + model;
  }

  if (intent === "plan") {
    return "## Kế hoạch thực hiện\n\n**Mục tiêu:** " + prompt +
      "\n\n1. **Làm rõ đầu ra** — xác định kết quả cuối cùng và tiêu chí hoàn thành.\n2. **Kiểm tra hiện trạng** — dữ liệu, ràng buộc, dependency và phần đã có.\n3. **Chia nhỏ** — ưu tiên việc có thể kiểm chứng độc lập.\n4. **Triển khai** — làm từ phần nền tảng đến phần phụ thuộc.\n5. **Kiểm thử** — kiểm tra happy path, edge case và lỗi quyền/dữ liệu.\n6. **Hoàn thiện** — tối ưu UX, hiệu năng và khả năng bảo trì.\n\n**Intent:** plan · **Model:** " + model;
  }

  if (intent === "compare") {
    return "## So sánh có cấu trúc\n\n**Đối tượng:** " + prompt +
      "\n\n| Tiêu chí | Phương án A | Phương án B |\n|---|---|---|\n| Mục tiêu | Cần xác định | Cần xác định |\n| Chi phí/nguồn lực | Phụ thuộc cấu hình | Phụ thuộc cấu hình |\n| Độ phức tạp | Cần kiểm tra | Cần kiểm tra |\n| Rủi ro | Cần kiểm tra | Cần kiểm tra |\n| Khi phù hợp | Theo yêu cầu thực tế | Theo yêu cầu thực tế |\n\nMình sẽ ưu tiên dữ kiện từ context thay vì tự bịa thông số.\n\n**Intent:** compare · **Model:** " + model;
  }

  if (intent === "explain") {
    return "## Giải thích\n\n**Chủ đề:** " + prompt +
      "\n\n### Hiểu nhanh\nTách vấn đề thành **khái niệm → cơ chế → ví dụ → giới hạn** để tránh trả lời theo kiểu chỉ đưa định nghĩa.\n\n### Context liên quan\n" +
      (context ? context.slice(-1800) : "Chưa có context trước đó.") +
      "\n\n**Intent:** explain · **Model:** " + model;
  }

  if (intent === "rewrite") {
    return "## Viết lại\n\nMình đã nhận nội dung cần chỉnh. Luồng xử lý ưu tiên **giữ nguyên ý nghĩa → sửa cấu trúc → làm câu tự nhiên → kiểm tra giọng văn**.\n\n> " +
      prompt + "\n\n**Intent:** rewrite · **Model:** " + model;
  }

  if (intent === "translate") {
    return "## Dịch\n\nMình đã nhận yêu cầu dịch. Để bản dịch chính xác, mình sẽ ưu tiên **ngữ cảnh → nghĩa câu → thuật ngữ → giọng văn**, thay vì dịch từng từ máy móc.\n\n> " +
      prompt + "\n\n**Intent:** translate · **Model:** " + model;
  }

  if (intent === "brainstorm") {
    return "## Brainstorm\n\nTừ yêu cầu của bạn, hãy tách ý tưởng thành 4 nhóm:\n\n- **Core:** chức năng bắt buộc.\n- **Differentiator:** điểm tạo khác biệt.\n- **UX:** cách người dùng trải nghiệm.\n- **Scale:** cách mở rộng sau này.\n\n**Ý tưởng đầu vào:** " + prompt + "\n\n**Intent:** brainstorm · **Model:** " + model;
  }

  return "## Legendary Engine\n\nMình đã phân tích yêu cầu theo intent **general** và giữ context gần nhất của phiên chat.\n\n**Yêu cầu:** " + prompt +
    "\n\n### Context gần nhất\n" + (context ? context.slice(-2400) : "Chưa có context trước đó.") +
    "\n\n### Cách xử lý\n- Không tự bịa dữ kiện chưa có.\n- Ưu tiên thông tin người dùng vừa cung cấp.\n- Khi có model self-hosted khả dụng, chuyển yêu cầu sang model thật thay vì Native Core." +
    attachmentHint +
    "\n\n**Model:** " + model + (system ? "\n**System instruction:** đã áp dụng." : "");
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
