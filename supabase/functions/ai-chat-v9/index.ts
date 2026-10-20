// Deprecated route disabled in favor of ai-chat-v10.
// Kept as a 410 response for any stale client; no model provider or token mutation is invoked.
const ORIGINS = new Set([
  "https://legendaryai.vercel.app",
  "https://www.legendaryai.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
if (siteUrl) ORIGINS.add(siteUrl);

function response(req: Request, body: unknown, status: number) {
  const origin = req.headers.get("origin") || "";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Vary": "Origin",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ORIGINS.has(origin)) {
    return response(req, { error: "Origin not allowed", code: "ORIGIN_NOT_ALLOWED" }, 403);
  }
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        ...(ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Vary": "Origin",
      },
    });
  }
  return response(req, {
    error: "This chat route is retired. Use ai-chat-v10.",
    code: "CHAT_ROUTE_RETIRED",
  }, 410);
});
