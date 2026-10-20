import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ORIGINS = new Set([
  "https://legendaryai.vercel.app",
  "https://www.legendaryai.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);
const configuredSiteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
if (configuredSiteUrl) ORIGINS.add(configuredSiteUrl);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    ...(ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Credentials": "true",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin"
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: "Origin not allowed", code: "ORIGIN_NOT_ALLOWED" }), {
      status: 403,
      headers: { "Content-Type": "application/json; charset=utf-8", Vary: "Origin" }
    });
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }), { status: 405, headers: cors(req) });

  const url = Deno.env.get("LEGENDARY_LOCAL_AI_URL")?.replace(/\/$/, "") || "";
  if (!url) {
    return new Response(JSON.stringify({ ok: false, code: "MODEL_UNAVAILABLE", provider: "ollama-compatible", configured: false }), { status: 503, headers: cors(req) });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${url}/api/tags`, { signal: controller.signal });
    const raw = await response.text();
    if (!response.ok) {
      return new Response(JSON.stringify({ ok: false, code: "MODEL_UNAVAILABLE", provider: "ollama-compatible", configured: true, status: response.status }), { status: 503, headers: cors(req) });
    }
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
    return new Response(JSON.stringify({ ok: true, provider: "ollama-compatible", configured: true, models: Array.isArray(data?.models) ? data.models.map((m: any) => String(m?.name || "")).filter(Boolean) : [] }), { status: 200, headers: cors(req) });
  } catch (_) {
    return new Response(JSON.stringify({ ok: false, code: "MODEL_UNAVAILABLE", provider: "ollama-compatible", configured: true }), { status: 503, headers: cors(req) });
  } finally {
    clearTimeout(timer);
  }
});
