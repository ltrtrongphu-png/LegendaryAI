import { createClient } from "npm:@supabase/supabase-js@2";
import { buildModelSystemPrompt, detectIntent, nativeAnswer } from "./brain-core.js";

const ORIGINS = new Set([
  "https://legendaryai.vercel.app",
  "https://www.legendaryai.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const SHIELD_WINDOW_MS = 60_000;
const SHIELD_MAX_REQUESTS = 20;
const SHIELD_MAX_BODY_BYTES = 1_500_000;
const SHIELD_BUCKET_MAX = 2000;
const MAX_MESSAGES = 60;
const MAX_CONTEXT_CHARS = 60_000;
const CACHE_TTL_MS = 15_000;
const LOCAL_TIMEOUT_MS = 12_000;
const cache = new Map<string, { created: number; text: string }>();
const buckets = new Map<string, { started: number; count: number; last: number }>();

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://legendaryai.vercel.app",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

function out(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(req), ...extra },
  });
}

function textOf(value: any): string {
  if (Array.isArray(value)) {
    return value.map((x: any) => typeof x === "string" ? x : x?.type === "text" ? x.text || "" : x?.type === "image" ? `[IMAGE:${String(x.name || "image")}]` : x?.text || x?.content || "").join("\n");
  }
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}

function approxTokens(text: string) { return Math.max(1, Math.ceil(String(text || "").length / 4)); }

function modelFor(plan: string) {
  return plan === "legendary" ? "legendary-ultra-1" : plan === "pro" ? "legendary-pro-1" : "legendary-lite-1";
}

function allowed(plan: string, role: string, tier: string) {
  if (role === "owner") return true;
  if (plan === "legendary") return ["free", "pro", "legendary"].includes(tier);
  if (plan === "pro") return ["free", "pro"].includes(tier);
  return tier === "free";
}

function cleanupBuckets(now: number) {
  if (buckets.size <= SHIELD_BUCKET_MAX) return;
  for (const [key, value] of buckets) {
    if (now - value.started >= SHIELD_WINDOW_MS) buckets.delete(key);
    if (buckets.size <= SHIELD_BUCKET_MAX) break;
  }
}

function shield(req: Request, userId: string, rawBody: string) {
  const now = Date.now();
  cleanupBuckets(now);
  if (new TextEncoder().encode(rawBody).byteLength > SHIELD_MAX_BODY_BYTES) return { ok: false, code: "REQUEST_TOO_LARGE", retryAfter: 60 };
  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";
  const ip = forwarded.split(",")[0].trim() || "unknown";
  const key = `${userId}:${ip}`;
  const old = buckets.get(key);
  if (!old || now - old.started >= SHIELD_WINDOW_MS) {
    buckets.set(key, { started: now, count: 1, last: now });
    return { ok: true, remaining: SHIELD_MAX_REQUESTS - 1 };
  }
  if (now - old.last < 50) return { ok: false, code: "REQUEST_BURST", retryAfter: 1 };
  old.last = now;
  old.count++;
  if (old.count > SHIELD_MAX_REQUESTS) return { ok: false, code: "RATE_LIMITED", retryAfter: Math.max(1, Math.ceil((SHIELD_WINDOW_MS - (now - old.started)) / 1000)) };
  return { ok: true, remaining: SHIELD_MAX_REQUESTS - old.count };
}

function normalizeMessages(messages: any[]) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant" || m.role === "ai"))
    .slice(-MAX_MESSAGES)
    .map((m: any) => ({ role: m.role === "ai" ? "assistant" : m.role, content: textOf(m.content) }));
}

function contextMessages(messages: any[], currentPrompt: string) {
  const normalized = normalizeMessages(messages);
  const terms = new Set((currentPrompt.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).slice(0, 24));
  const scored = normalized.map((m, index) => {
    const lower = m.content.toLowerCase();
    let score = index >= normalized.length - 10 ? 3 : 0;
    for (const term of terms) if (lower.includes(term)) score++;
    return { m, index, score };
  });
  const recent = scored.slice(-10).map(x => x.m);
  const relevant = scored.filter(x => x.index < normalized.length - 10).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 14).map(x => x.m);
  const merged: any[] = [];
  const seen = new Set<number>();
  for (const item of [...relevant, ...recent]) {
    const index = normalized.indexOf(item);
    if (index >= 0 && !seen.has(index)) { seen.add(index); merged.push(item); }
  }
  let total = 0;
  const kept: any[] = [];
  for (const m of merged) {
    const size = m.content.length;
    if (kept.length && total + size > MAX_CONTEXT_CHARS) continue;
    kept.push(m);
    total += size;
  }
  return kept;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}

function cacheGet(key: string) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.created > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.text;
}

function cacheSet(key: string, text: string) {
  cache.set(key, { created: Date.now(), text });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
}

function outputBudget(intent: string, configured: number) {
  const caps: Record<string, number> = { greeting: 512, math: 1024, image: 512, writing: 4096, translate: 4096, summarize: 6144, code: 12288, plan: 8192, compare: 8192, explain: 8192, brainstorm: 6144, general: 8192 };
  return Math.min(configured, caps[intent] || 8192);
}

async function localChat(url: string, model: string, messages: any[], system: string, maxTokens: number, temperature: number) {
  const base = url.replace(/\/$/, "");
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOCAL_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: "system", content: buildModelSystemPrompt(system) }, ...messages],
          options: { temperature, num_predict: maxTokens },
        }),
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`Local AI HTTP ${response.status}: ${raw.slice(0, 300)}`);
      const data = raw ? JSON.parse(raw) : null;
      const text = String(data?.message?.content || data?.response || "").trim();
      if (!text) throw new Error("Local AI returned an empty response");
      return text;
    } catch (error) {
      lastError = error;
      if (attempt === 0 && !(error instanceof DOMException && error.name === "AbortError")) await new Promise(r => setTimeout(r, 250));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Local AI request failed");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return out(req, { error: "Method not allowed" }, 405);
  const auth = req.headers.get("Authorization");
  if (!auth) return out(req, { error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return out(req, { error: "Server configuration missing", code: "SERVER_CONFIG" }, 503);

  const admin = createClient(supabaseUrl, serviceKey);
  const token = auth.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return out(req, { error: "Unauthorized" }, 401);

  let body: any;
  let rawBody = "";
  try { rawBody = await req.text(); body = JSON.parse(rawBody); }
  catch { return out(req, { error: "Invalid JSON" }, 400); }

  const shieldResult = shield(req, authData.user.id, rawBody);
  if (!shieldResult.ok) return out(req, { error: "Legendary Shield blocked this request.", code: shieldResult.code, retryAfter: shieldResult.retryAfter }, 429, { "Retry-After": String(shieldResult.retryAfter) });

  const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
  const userPrompt = textOf([...rawMessages].reverse().find((m: any) => m?.role === "user")?.content).trim();
  if (!userPrompt) return out(req, { error: "messages is required" }, 400);

  const { data: profile, error: profileError } = await admin.from("profiles").select("role,plan,token_limit,tokens_used,token_reset_at,memory_enabled,vision_enabled").eq("id", authData.user.id).maybeSingle();
  if (profileError || !profile) return out(req, { error: "Profile could not be loaded", code: "PROFILE_NOT_FOUND" }, 500);

  const plan = String(profile.plan || "free");
  const role = String(profile.role || "user");
  let modelKey = modelFor(plan);
  const requested = typeof body?.model === "string" ? body.model.trim() : "auto";
  if (requested && requested !== "auto") {
    const { data: selected } = await admin.from("ai_models").select("key,tier,enabled").eq("key", requested).eq("enabled", true).maybeSingle();
    if (!selected) return out(req, { error: "Model không tồn tại hoặc đang tắt.", code: "MODEL_NOT_AVAILABLE" }, 400);
    if (selected.tier === "system" ? role !== "owner" : !allowed(plan, role, selected.tier)) return out(req, { error: "Model này không thuộc quyền của gói hiện tại.", code: "MODEL_FORBIDDEN" }, 403);
    modelKey = selected.key;
  }

  const { data: model, error: modelError } = await admin.from("ai_models").select("key,display_name,tier,provider,model_id,max_output_tokens,capabilities,system_prompt,enabled").eq("key", modelKey).eq("enabled", true).maybeSingle();
  if (modelError || !model) return out(req, { error: "Legendary model is not configured", code: "MODEL_NOT_CONFIGURED" }, 503);

  const intent = detectIntent(userPrompt);
  const configuredMax = Math.min(Math.max(Number(body?.max_tokens) || Number(model.max_output_tokens) || 8192, 256), Number(model.max_output_tokens) || 8192);
  const maxTokens = outputBudget(intent, configuredMax);
  const selectedMessages = contextMessages(rawMessages, userPrompt);
  const inputTokens = approxTokens(selectedMessages.map(m => m.content).join("\n"));
  const reserve = Math.max(1, Math.min(inputTokens + maxTokens, Number(profile.token_limit || 150000)));

  const { data: tokenOk, error: tokenError } = await admin.rpc("consume_tokens", { p_amount: reserve });
  if (tokenError) return out(req, { error: tokenError.message, code: "TOKEN_RPC_ERROR" }, 500);
  if (!tokenOk) return out(req, { error: "Bạn đã chạm hạn mức token của gói hiện tại.", code: "TOKEN_LIMIT", tokenLimit: Number(profile.token_limit || 0), tokensUsed: Number(profile.tokens_used || 0), tokenResetAt: profile.token_reset_at }, 429);

  const startedAt = Date.now();
  try {
    const system = typeof body?.system === "string" ? body.system.trim() : String(model.system_prompt || "");
    const gateway = Deno.env.get("LEGENDARY_LOCAL_AI_URL") || "";
    const canUseLocal = Boolean(gateway && model.provider === "ollama-compatible" && model.model_id);
    const cacheKey = await sha256(JSON.stringify({ model: model.key, system, messages: selectedMessages, temperature: Number(body?.temperature ?? 0.3), maxTokens }));
    let text = cacheGet(cacheKey);
    const cacheHit = Boolean(text);
    let route = canUseLocal ? "local-ai" : "native-core";
    let fallbackUsed = false;
    let action = "text";

    if (!text && canUseLocal) {
      try {
        text = await localChat(gateway, model.model_id, selectedMessages, system, maxTokens, Number(body?.temperature ?? 0.3));
      } catch {
        fallbackUsed = true;
        route = "native-fallback";
      }
    }

    if (!text) {
      const native = nativeAnswer(userPrompt, selectedMessages);
      text = native.text;
      action = native.action || "text";
      route = fallbackUsed ? "native-fallback" : "native-core";
    }

    if (!cacheHit && text && route === "local-ai") cacheSet(cacheKey, text);

    const outputTokens = approxTokens(text);
    const actualTokens = inputTokens + outputTokens;
    if (reserve > actualTokens) await admin.rpc("refund_tokens", { p_amount: reserve - actualTokens });
    const { data: latest } = await admin.from("profiles").select("token_limit,tokens_used,token_reset_at").eq("id", authData.user.id).maybeSingle();
    const latencyMs = Date.now() - startedAt;
    await admin.from("ai_usage_logs").insert({ user_id: authData.user.id, model_key: model.key, provider_model: model.model_id, plan, input_tokens: inputTokens, output_tokens: outputTokens, reserved_tokens: reserve, request_ms: latencyMs, status: "success" });

    return out(req, {
      requestId: crypto.randomUUID(),
      model: model.key,
      displayModel: model.display_name || model.key,
      providerModel: model.model_id,
      tier: model.tier,
      capabilities: Array.isArray(model.capabilities) ? model.capabilities : [],
      fallbackUsed,
      local: route === "local-ai",
      native: route !== "local-ai",
      text,
      action,
      plan,
      brain: { version: "10.0", intent, route, cacheHit, contextMessages: selectedMessages.length, rawContextMessages: rawMessages.length, selfCheck: true },
      performance: { latency_ms: latencyMs, cache_hit: cacheHit, context_compacted: rawMessages.length !== selectedMessages.length },
      usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: actualTokens, tokens_used: Number(latest?.tokens_used ?? Number(profile.tokens_used || 0) + actualTokens), token_limit: Number(latest?.token_limit ?? profile.token_limit), remaining_tokens: Math.max(0, Number(latest?.token_limit ?? profile.token_limit) - Number(latest?.tokens_used ?? 0)) },
    });
  } catch (error) {
    await admin.rpc("refund_tokens", { p_amount: reserve });
    return out(req, { error: error instanceof Error ? error.message : "AI engine error", code: "AI_ENGINE_ERROR" }, 502);
  }
});
