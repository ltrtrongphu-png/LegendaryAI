import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders as supabaseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";

const configuredSiteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
const baseCorsHeaders = {
  ...supabaseCorsHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = configuredSiteUrl || origin || "*";
  return {
    ...baseCorsHeaders,
    "Access-Control-Allow-Origin": allowedOrigin,
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(req ? getCorsHeaders(req) : baseCorsHeaders),
    },
  });
}

const MODEL_BY_PLAN: Record<string, string> = {
  free: "legendary-lite-1",
  pro: "legendary-reasoner-32b",
  legendary: "legendary-ultra-120b",
};

const FALLBACK_BY_PLAN: Record<string, string> = {
  free: "legendary-lite-1",
  pro: "legendary-pro-1",
  legendary: "legendary-ultra-1",
};

const PLAN_FEATURES: Record<string, Record<string, boolean | number | string>> = {
  free: {
    token_limit: 150000,
    memory: false,
    session_context: true,
    vision: false,
    file_analysis: false,
    advanced_reasoning: false,
    quick_reasoning: true,
    smart_math: true,
    smart_formatting: true,
    advanced_memory: false,
    long_context: false,
    priority: false,
    token_reset_hours: 6,
    manual_reset: false,
  },
  pro: {
    token_limit: 2000000,
    memory: true,
    vision: true,
    file_analysis: true,
    advanced_reasoning: true,
    advanced_memory: false,
    long_context: true,
    priority: true,
    token_reset_hours: 12,
    manual_reset: true,
  },
  legendary: {
    token_limit: 6000000,
    memory: true,
    vision: true,
    file_analysis: true,
    advanced_reasoning: true,
    advanced_memory: true,
    long_context: true,
    priority: true,
    token_reset_hours: 18,
    manual_reset: true,
  },
};

function routeModelByTask(plan: string, role: string, prompt: string): string {
  const text = (prompt || "").toLowerCase();

  if (/vision|ảnh|image|hình ảnh|screenshot|camera|ocr/.test(text)) {
    if (plan === "pro") return "legendary-vision-pro-11b";
    if (plan === "legendary" || role === "owner") return "legendary-vision-109b";
  }

  if ((plan === "legendary" || role === "owner") &&
      /reason|reasoning|suy luận|chứng minh|toán|math|logic|debug|kiến trúc|architecture|phân tích sâu/.test(text)) {
    return "legendary-ultra-120b";
  }

  if ((plan === "pro" || plan === "legendary" || role === "owner") &&
      /code|coding|javascript|typescript|python|sql|supabase|github|debug|lỗi|bug|api|backend|frontend/.test(text)) {
    return "legendary-reasoner-32b";
  }

  return MODEL_BY_PLAN[plan] || MODEL_BY_PLAN.free;
}

function detectIntent(prompt: string): string {
  const text = (prompt || "").toLowerCase();
  if (/ảnh|image|vision|screenshot|ocr|hình/.test(text)) return "vision";
  if (/code|coding|javascript|typescript|python|sql|debug|bug|api|supabase|github/.test(text)) return "coding";
  if (/tính|math|toán|phương trình|calculate|logic|reason|suy luận|chứng minh/.test(text)) return "reasoning";
  if (/viết|soạn|email|content|rewrite|dịch|translate/.test(text)) return "writing";
  if (/tóm tắt|summarize|summary|tổng hợp/.test(text)) return "summarization";
  return "general";
}

const SYSTEM_DEFAULT = `You are LegendaryAI, the native AI core of LegendaryAI.

Core principles:
- Understand the user's actual goal before answering.
- Use the full available conversation context.
- Never claim to have used a tool, web search, file, API, or external model when you did not.
- Never invent sources, facts, benchmark numbers, or completed actions.
- For code, prefer secure, maintainable, production-ready solutions and explain important trade-offs.
- For writing, follow the requested audience, tone, structure, and language.
- For reasoning, work step-by-step internally and present a clear, useful result.
- If information is uncertain or unavailable, say so plainly and give the best supported next step.
- Keep answers concise by default, but go deep when the task requires it.
- LegendaryAI is currently Legendary-only and does not call Claude, OpenAI, ChatGPT, Anthropic, or other external AI providers.`;

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

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part: any) => {
      if (typeof part === "string") return part;
      return part?.text || part?.content || "";
    }).join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

function hasImageContent(content: unknown): boolean {
  return Array.isArray(content) && content.some((part: any) =>
    part && part.type === "image" && typeof part.image === "string"
  );
}

function cleanMessages(messages: any[], maxChars: number): any[] {
  const cleaned = messages
    .filter((m: any) => m && ["user", "assistant", "system"].includes(m.role))
    .map((m: any) => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content
            .filter((part: any) => part && (part.type === "text" || part.type === "image"))
            .map((part: any) => part.type === "image"
              ? { type: "image", image: String(part.image || "").slice(0, 8_000_000), name: part.name || "image" }
              : { type: "text", text: String(part.text || part.content || "").slice(0, 12000) })
        : textFromContent(m.content).slice(0, 12000),
    }));

  let total = 0;
  const kept: any[] = [];
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const item = cleaned[i];
    const size = (typeof item.content === "string"
      ? item.content.length
      : textFromContent(item.content).length + JSON.stringify(item.content).length) + 40;
    if (kept.length && total + size > maxChars) break;
    kept.unshift(item);
    total += size;
  }
  return kept;
}

function safeArithmetic(input: string): number | null {
  const expression = input
    .replace(/,/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .trim();

  if (!/^[0-9+\-*/().%\s]+$/.test(expression) || !/[0-9]/.test(expression)) {
    return null;
  }

  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/%]/g);
  if (!tokens) return null;

  const values: number[] = [];
  const ops: string[] = [];
  const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2 };

  const apply = () => {
    const op = ops.pop();
    const b = values.pop();
    const a = values.pop();
    if (op == null || a == null || b == null) throw new Error("bad expression");
    if (op === "/" && b === 0) throw new Error("division by zero");
    if (op === "+") values.push(a + b);
    else if (op === "-") values.push(a - b);
    else if (op === "*") values.push(a * b);
    else if (op === "/") values.push(a / b);
    else if (op === "%") values.push(a % b);
  };

  try {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (/^\d/.test(token)) {
        values.push(Number(token));
        continue;
      }
      if (token === "(") {
        ops.push(token);
        continue;
      }
      if (token === ")") {
        while (ops.length && ops[ops.length - 1] !== "(") apply();
        if (ops.pop() !== "(") return null;
        continue;
      }
      while (
        ops.length &&
        ops[ops.length - 1] !== "(" &&
        precedence[ops[ops.length - 1]] >= precedence[token]
      ) apply();
      ops.push(token);
    }
    while (ops.length) {
      if (ops[ops.length - 1] === "(") return null;
      apply();
    }
    if (values.length !== 1 || !Number.isFinite(values[0])) return null;
    return values[0];
  } catch {
    return null;
  }
}

async function ollamaResponse(
  baseUrl: string,
  modelId: string,
  messages: any[],
  system: string,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  const url = baseUrl.replace(/\/$/, "") + "/api/chat";
  const payloadMessages = [
    ...(system ? [{ role: "system", content: system }] : []),
    ...messages.map((m: any) => {
      const role = m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user";
      if (!Array.isArray(m.content)) return { role, content: textFromContent(m.content) };
      const content = m.content
        .filter((p: any) => p?.type === "text")
        .map((p: any) => p.text || "")
        .join("\n");
      const images = m.content
        .filter((p: any) => p?.type === "image" && typeof p.image === "string")
        .map((p: any) => String(p.image).replace(/^data:[^;]+;base64,/, ""));
      return images.length ? { role, content, images } : { role, content };
    }),
  ];

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelId,
      messages: payloadMessages,
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens,
      },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Self-hosted model error (${response.status}): ${raw.slice(0, 600)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Self-hosted model returned invalid JSON.");
  }

  const text = data?.message?.content || data?.response || "";
  if (!text) throw new Error("Self-hosted model returned no text.");
  return String(text);
}

const TOOL_PROMPTS: Record<string, string> = {
  summarize: "Summarize the supplied material. Return the key points, decisions, risks, and next actions. Do not invent missing facts.",
  rewrite: "Rewrite the user's material while preserving meaning. Improve clarity, structure, grammar, and tone. Return only the requested rewritten result unless explanation is requested.",
  plan: "Create an actionable plan with goal, assumptions, ordered steps, dependencies, risks, and a verification checklist.",
  code_review: "Perform a production-grade code review. Identify correctness bugs, security issues, edge cases, maintainability problems, and concrete fixes. Prioritize findings by severity.",
  debug: "Debug systematically. Identify likely root cause, evidence, reproduction steps, and the smallest safe fix. Do not pretend to execute code.",
  email: "Draft a complete send-ready email. Infer a professional structure from the request, but never invent sensitive facts.",
  translate: "Translate accurately while preserving meaning, formatting, terminology, and tone. Do not add commentary unless asked.",
  extract: "Extract the requested facts into a compact structured format. If JSON is requested, return valid JSON only.",
  json: "Return valid JSON only. Do not wrap it in markdown fences. Preserve the requested schema exactly.",
};

function normalizeTool(value: unknown): string {
  const tool = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TOOL_PROMPTS, tool) ? tool : "";
}

function toolInstruction(tool: string): string {
  return tool && TOOL_PROMPTS[tool] ? "\n\nACTIVE TOOL MODE: " + tool + "\n" + TOOL_PROMPTS[tool] : "";
}

function modelName(modelKey: string): string {
  if (modelKey === "legendary-ultra-1") return "LegendaryUltra-1";
  if (modelKey === "legendary-pro-1") return "LegendaryPro-1";
  if (modelKey === "custom") return "Legendary Custom Core";
  if (modelKey === "legendary-reasoner-32b") return "Legendary Reasoner 32B";
  if (modelKey === "legendary-vision-pro-11b") return "Legendary Vision Pro 11B";
  if (modelKey === "legendary-ultra-120b") return "Legendary Ultra 120B";
  if (modelKey === "legendary-vision-109b") return "Legendary Vision 109B";
  return "LegendaryLite-1";
}

function extractMemoryCandidates(prompt: string): string[] {
  const p = (prompt || "").trim();
  if (!p) return [];

  const patterns = [
    /(?:hãy nhớ|nhớ rằng|ghi nhớ|remember that)[:\\s]+(.{4,300})$/i,
    /(?:tôi tên là|mình tên là|my name is)[:\\s]+(.{2,80})$/i,
    /(?:tôi thích|mình thích|i like)[:\\s]+(.{3,200})$/i,
    /(?:tôi không thích|mình không thích|i dislike)[:\\s]+(.{3,200})$/i,
    /(?:tôi đang làm|mình đang làm|i am working on)[:\\s]+(.{3,240})$/i,
  ];

  const results: string[] = [];
  for (const pattern of patterns) {
    const match = p.match(pattern);
    if (match?.[1]) results.push(match[1].trim());
  }

  return [...new Set(results)];
}

function memoryAugmentedSystem(system: string, memories: string[], maxCount = 10): string {
  if (!memories.length) return system;
  const memoryBlock = memories
    .slice(0, maxCount)
    .map((m) => "- " + m)
    .join("\n");
  return system + "\n\nLONG-TERM MEMORY (trusted user-provided context; use only when relevant):\n" + memoryBlock;
}

function localLegendaryResponse(
  modelKey: string,
  messages: any[],
  system: string,
  memories: string[],
): string {
  const latest = [...messages].reverse().find((m: any) => m?.role === "user");
  const prompt = textFromContent(latest?.content).trim();
  const lower = prompt.toLowerCase();
  const name = modelName(modelKey);
  const recent = messages.slice(-8).map((m: any) => `${m.role}: ${textFromContent(m.content)}`).join("\n");
  const memoryText = memories.length
    ? memories.slice(0, 8).map((m) => "- " + m).join("\n")
    : "";

  if (!prompt) {
    return "Mình đã sẵn sàng. Hãy gửi yêu cầu cụ thể để Legendary Engine xử lý.";
  }

  const arithmeticCandidate = prompt
    .replace(/^(tính|calculate|giúp tôi tính|=?)[\s:]*/i, "")
    .trim();
  const arithmetic = safeArithmetic(arithmeticCandidate);
  if (arithmetic !== null && /[+\-*/%]|×|÷/.test(arithmeticCandidate)) {
    return `## Kết quả\n\n**${arithmetic}**\n\nLegendary Engine đã phân tích biểu thức trực tiếp bằng core tính toán nội bộ.`;
  }

  if (/^(xin chào|chào|hello|hi|hey)\b/i.test(prompt)) {
    return `Xin chào! Mình là **${name}**, core AI native của LegendaryAI.\n\nMình đang dùng context của cuộc trò chuyện và memory được phép của tài khoản; không gọi Claude, OpenAI, ChatGPT hay API AI bên ngoài.`;
  }

  if (/(debug|lỗi|error|bug|code|javascript|typescript|python|java|sql|html|css|supabase|github)/i.test(prompt)) {
    const codeHints = [];
    if (/undefined|cannot read|null/i.test(prompt)) codeHints.push("Kiểm tra biến có thể null/undefined trước khi truy cập thuộc tính.");
    if (/cors|cross.origin/i.test(prompt)) codeHints.push("Kiểm tra Origin, CORS headers và endpoint backend; không đưa secret vào browser.");
    if (/401|unauthorized|auth/i.test(prompt)) codeHints.push("Kiểm tra access token, session hiện tại và bước xác thực ở server.");
    if (/404|not found/i.test(prompt)) codeHints.push("Kiểm tra route/function name, deployment và URL endpoint.");
    if (!codeHints.length) codeHints.push("Tách lỗi thành input → state → request → response, sau đó kiểm tra log ở từng lớp.");

    return `## Legendary Code Reasoning\n\n**Yêu cầu:**\n> ${prompt}\n\n### Hướng xử lý\n${codeHints.map((x) => "- " + x).join("\n")}\n\n### Context gần nhất\n\`\`\`text\n${recent.slice(-2200)}\n\`\`\`\n\nCore model: **${name}**. Nếu bạn gửi file/code hoặc log đầy đủ, mình có thể bám trực tiếp vào nội dung đó thay vì đoán.`;
  }

  if (/(viết|soạn|email|bài|content|rewrite|dịch|translate|kịch bản|mô tả)/i.test(prompt)) {
    return `## Soạn thảo\n\nMình đã nhận yêu cầu: **${prompt}**\n\nĐể tạo bản hoàn chỉnh, hãy cung cấp (nếu có):\n1. Đối tượng đọc.\n2. Giọng văn mong muốn.\n3. Độ dài hoặc định dạng.\n\nLegendary Engine sẽ ưu tiên giữ đúng yêu cầu và context thay vì tự bịa thông tin chưa được cung cấp.`;
  }

  if (/(tóm tắt|summarize|tổng hợp|rút gọn)/i.test(prompt)) {
    const source = recent.replace(/^\w+:\s*/gm, "").slice(-5000);
    return `## Tóm tắt context hiện có\n\n${source || "Chưa có đủ nội dung nguồn để tóm tắt."}\n\n> Đây là bản tóm tắt từ context đã gửi cho Legendary Engine; chưa có web search trong phiên này.`;
  }

  if (/(checklist|liệt kê|danh sách|bullet|gạch đầu dòng)/i.test(prompt)) {
    const items = prompt
      .replace(/^(hãy|giúp tôi|cho tôi|tạo|làm)\s+/i, "")
      .split(/[,;]|\s+và\s+/i)
      .map((x) => x.trim())
      .filter((x) => x.length > 2)
      .slice(0, 10);
    return items.length > 1
      ? "## Checklist nhanh\n\n" + items.map((x, i) => (i + 1) + ". " + x).join("\n") + "\n\n**Free Quick Mode** · LegendaryLite-1"
      : "## Checklist nhanh\n\n- Làm rõ mục tiêu\n- Chia việc thành bước nhỏ\n- Kiểm tra kết quả\n\n**Free Quick Mode** · LegendaryLite-1";
  }

  if (/(ai là|what is|là gì|giải thích|explain)/i.test(prompt)) {
    return `## Phân tích yêu cầu\n\nBạn đang hỏi: **${prompt}**\n\nLegendary Engine hiện ưu tiên trả lời từ context, memory và các năng lực core đã triển khai. Với dữ liệu kiến thức bên ngoài chưa có trong context, mình sẽ không giả vờ đã tra web.\n\n**Memory liên quan:**\n${memoryText || "- Không có memory được lưu cho phiên này."}`;
  }

  return `## Legendary Engine\n\nMình đã nhận yêu cầu:\n\n> ${prompt}\n\n### Cách mình xử lý\n- Giữ context của các tin nhắn gần nhất.\n- Áp dụng system instruction của LegendaryAI.\n- Ưu tiên câu trả lời có cấu trúc, kiểm chứng được và không bịa nguồn.\n- Dùng memory của tài khoản khi được bật.\n\n**Model core:** ${name}\n**Chế độ:** Native Legendary / Local Core\n\n${memoryText ? "### Memory đang hoạt động\n" + memoryText : "Memory chưa có dữ liệu liên quan."}`;
}

Deno.serve(async (req) => {
  const responseCors = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseCors });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, req);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Unauthorized" }, 401, req);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Supabase server configuration is missing.", code: "SERVER_CONFIG" }, 503, req);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: auth } },
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401, req);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON.", code: "INVALID_JSON" }, 400, req);
  }

  const requestStarted = Date.now();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json({ error: "messages is required", code: "MESSAGES_REQUIRED" }, 400, req);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,plan,token_limit,tokens_used,token_reset_at,memory_enabled,vision_enabled,web_search_enabled")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) return json({ error: "Profile not found.", code: "PROFILE_NOT_FOUND" }, 404, req);

  const requested = typeof body.model === "string" ? body.model.trim() : "";
  const provisionalLastUser = [...messages].reverse().find((m: any) => m?.role === "user");
  const provisionalPrompt = textFromContent(provisionalLastUser?.content);
  const requestedKey = requested && requested !== "auto"
    ? requested
    : routeModelByTask(profile.plan, profile.role, provisionalPrompt);

  const { data: requestedModel } = await supabase
    .from("ai_models")
    .select("key,display_name,tier,provider,model_id,context_window,max_output_tokens,capabilities,system_prompt,enabled")
    .eq("key", requestedKey)
    .eq("enabled", true)
    .maybeSingle();

  let selectedModel = requestedModel;
  let fallbackUsed = false;

  if (
    !selectedModel ||
    !["local", "ollama-compatible"].includes(selectedModel.provider) ||
    !tierAllowed(profile.role, profile.plan, selectedModel.tier)
  ) {
    const entitledKey = MODEL_BY_PLAN[profile.plan] || MODEL_BY_PLAN.free;
    const fallbackKey = FALLBACK_BY_PLAN[profile.plan] || FALLBACK_BY_PLAN.free;

    let fallback = null;
    const { data: entitledModel } = await supabase
      .from("ai_models")
      .select("key,display_name,tier,provider,model_id,context_window,max_output_tokens,capabilities,system_prompt,enabled")
      .eq("key", entitledKey)
      .eq("enabled", true)
      .maybeSingle();
    fallback = entitledModel;

    if (!fallback && fallbackKey !== entitledKey) {
      const { data: safeFallback } = await supabase
        .from("ai_models")
        .select("key,display_name,tier,provider,model_id,context_window,max_output_tokens,capabilities,system_prompt,enabled")
        .eq("key", fallbackKey)
        .eq("enabled", true)
        .maybeSingle();
      fallback = safeFallback;
    }

    selectedModel = fallback;
    fallbackUsed = true;
  }

  if (!selectedModel) {
    return json({ error: "Legendary model chưa được cấu hình cho tài khoản này.", code: "MODEL_NOT_CONFIGURED" }, 503, req);
  }

  const hasImages = messages.some((m: any) => hasImageContent(m?.content));
  if (hasImages && !profile.vision_enabled) {
    return json({
      error: "Phân tích hình ảnh cần gói Pro hoặc Legendary.",
      code: "VISION_PLAN_REQUIRED",
    }, 403, req);
  }

  const capabilities = Array.isArray(selectedModel.capabilities)
    ? selectedModel.capabilities
    : [];
  const planFeatures = PLAN_FEATURES[profile.plan] || PLAN_FEATURES.free;

  const maxContextChars = Math.min(
    Math.max(12000, Number(selectedModel.context_window || 32768) * 3),
    360000,
  );
  const normalizedMessages = cleanMessages(messages, maxContextChars);

  const system =
    (typeof body.system === "string" && body.system.trim())
      ? body.system.trim()
      : (selectedModel.system_prompt || SYSTEM_DEFAULT);

  let memories: string[] = [];
  const memoryLimit = profile.plan === "legendary" || profile.role === "owner" ? 24 : 12;
  if (profile.memory_enabled) {
    const { data: memoryRows } = await supabase
      .from("ai_memories")
      .select("memory,importance")
      .eq("user_id", user.id)
      .order("importance", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(memoryLimit);
    memories = (memoryRows || [])
      .map((row: any) => String(row.memory || "").trim())
      .filter(Boolean);
  }

  const lastUser = [...normalizedMessages].reverse().find((m: any) => m?.role === "user");
  const lastUserText = textFromContent(lastUser?.content);

  const requestedTool = normalizeTool(body.tool);
  const effectiveSystem = memoryAugmentedSystem(
    system + toolInstruction(requestedTool),
    memories,
    profile.plan === "legendary" || profile.role === "owner" ? 24 : 10,
  );
  const intent = requestedTool || detectIntent(lastUserText);

  if (profile.memory_enabled) {
    const candidates = extractMemoryCandidates(lastUserText);
    for (const memory of candidates.slice(0, 3)) {
      const exists = memories.some((m) => m.toLowerCase() === memory.toLowerCase());
      if (!exists) {
        await supabase.from("ai_memories").insert({
          user_id: user.id,
          memory,
          source: "chat",
          importance: /tên là|name is|hãy nhớ|nhớ rằng|remember/i.test(lastUserText) ? 9 : 7,
        });
      }
    }
  }

  const estimatedInputTokens = estimateTokens(
    normalizedMessages.map((m: any) => textFromContent(m.content)).join("\n")
  );

  const requestedOutput = Number(body.max_tokens) || Number(selectedModel.max_output_tokens) || 4096;
  const maxTokens = Math.min(
    Math.max(256, requestedOutput),
    Number(selectedModel.max_output_tokens || 4096),
  );
  const reservation = Math.max(
    1,
    Math.min(
      estimatedInputTokens + maxTokens,
      Number(profile.token_limit || 150000),
    ),
  );

  const { data: allowed, error: tokenError } = await supabase.rpc("consume_tokens", {
    p_amount: reservation,
  });

  if (tokenError) return json({ error: tokenError.message, code: "TOKEN_RPC_ERROR" }, 500, req);

  if (!allowed) {
    return json({
      error: "Bạn đã chạm hạn mức token của gói hiện tại. Hãy chờ reset hoặc nâng gói.",
      code: "TOKEN_LIMIT",
      tokenLimit: profile.token_limit,
      tokensUsed: profile.tokens_used,
      model: selectedModel.display_name,
    }, 429, req);
  }

  try {
    const temperature = Math.min(
      1.5,
      Math.max(0, Number(body.temperature ?? 0.35)),
    );

    let text: string;

    const deterministicArithmetic = requestedTool === "calculator"
      ? safeArithmetic(
          lastUserText
            .replace(/^(?:tính|calculate|calculator|calc)[:\\s]*/i, "")
            .trim(),
        )
      : null;

    if (requestedTool === "calculator" && deterministicArithmetic === null) {
      throw new Error("Calculator cần một biểu thức số học hợp lệ, ví dụ: 125 * (8 + 2).");
    }

    if (requestedTool === "calculator" && deterministicArithmetic !== null) {
      text = `## Calculator\\n\\n**${deterministicArithmetic}**\\n\\nĐã tính bằng bộ máy số học an toàn của LegendaryAI.`;
    } else if (selectedModel.provider === "ollama-compatible") {
      const baseUrl = selectedModel.base_url ||
        (selectedModel.base_url_env ? Deno.env.get(selectedModel.base_url_env) : "") ||
        "";
      if (!baseUrl) {
        throw new Error(
          "Self-hosted model chưa được cấu hình. Đặt secret LEGENDARY_LOCAL_AI_URL trong Supabase trước khi bật model này.",
        );
      }

      text = await ollamaResponse(
        baseUrl,
        selectedModel.model_id,
        normalizedMessages,
        effectiveSystem,
        maxTokens,
        temperature,
      );
    } else {
      text = localLegendaryResponse(
        selectedModel.key,
        normalizedMessages,
        effectiveSystem,
        memories,
      );
    }

    const estimatedOutputTokens = estimateTokens(text);
    const actualTokens = estimatedInputTokens + estimatedOutputTokens;
    const { data: tokenStateRows } = await supabase.rpc("finalize_tokens", {
      p_reserved: reservation,
      p_actual: actualTokens,
    });
    const tokenState = Array.isArray(tokenStateRows) ? tokenStateRows[0] : tokenStateRows;

    const usageLog = supabase.from("ai_usage_logs").insert({
      user_id: user.id,
      model_key: selectedModel.key,
      provider_model: selectedModel.model_id,
      plan: profile.plan,
      input_tokens: estimatedInputTokens,
      output_tokens: estimatedOutputTokens,
      reserved_tokens: reservation,
      request_ms: Date.now() - requestStarted,
      status: "success",
    });

    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(usageLog);
    else await usageLog;

    return json({
      model: selectedModel.key,
      displayModel: selectedModel.display_name || modelName(selectedModel.key),
      providerModel: selectedModel.model_id,
      tier: selectedModel.tier,
      capabilities,
      fallbackUsed,
      local: true,
      native: true,
      text,
      plan: profile.plan,
      planFeatures,
      brain: {
        version: "6.0",
        intent,
        tool: requestedTool || null,
        route: selectedModel.key,
        memory: profile.memory_enabled,
        session_context: !!planFeatures.session_context,
        memory_count: memories.length,
        capabilities,
        tools: {
          arithmetic: !!planFeatures.smart_math,
          quick_reasoning: !!planFeatures.quick_reasoning,
          smart_formatting: !!planFeatures.smart_formatting,
          summarizer: true,
          translator: true,
          structured_output: true,
          extraction: true,
          planning: true,
          code_review: true,
          calculator: !!planFeatures.smart_math,
          memory: profile.memory_enabled,
          web_search: !!profile.web_search_enabled,
          vision: !!profile.vision_enabled,
          self_hosted_models: true,
        },
      },
      usage: {
        estimated_input_tokens: estimatedInputTokens,
        estimated_output_tokens: estimatedOutputTokens,
        actual_tokens: actualTokens,
        reserved_tokens: reservation,
        tokens_used: Number(tokenState?.tokens_used ?? profile.tokens_used),
        tokens_remaining: Number(tokenState?.tokens_remaining ?? Math.max(Number(profile.token_limit) - Number(profile.tokens_used), 0)),
        token_limit: Number(tokenState?.token_limit ?? profile.token_limit),
        token_reset_at: tokenState?.token_reset_at ?? null,
        request_ms: Date.now() - requestStarted,
      },
    }, 200, req);
  } catch (error) {
    await supabase.rpc("refund_tokens", { p_amount: reservation }).catch(() => null);
    const message = error instanceof Error ? error.message : "Legendary Engine failed.";
    return json({ error: message, code: "LEGENDARY_ENGINE_ERROR" }, 500, req);
  }
});