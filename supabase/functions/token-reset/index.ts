import { createClient } from "npm:@supabase/supabase-js@2";

const configuredSiteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
const ORIGINS = new Set(["https://legendaryai.vercel.app", "https://www.legendaryai.vercel.app", "http://localhost:3000", "http://127.0.0.1:3000"]);
if (configuredSiteUrl) ORIGINS.add(configuredSiteUrl);
const baseCorsHeaders = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Credentials": "true",
};

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    ...baseCorsHeaders,
    ...(ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(req ? corsHeaders(req) : baseCorsHeaders),
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ORIGINS.has(origin)) return new Response(JSON.stringify({ error: "Origin not allowed", code: "ORIGIN_NOT_ALLOWED" }), { status: 403, headers: { "Content-Type": "application/json; charset=utf-8", Vary: "Origin" } });
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, req);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Unauthorized" }, 401, req);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server configuration missing" }, 503, req);

  const admin = createClient(url, key);
  const { data: { user }, error: userError } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (userError || !user) return json({ error: "Unauthorized" }, 401, req);

  const { data, error } = await admin.rpc("manual_reset_tokens", { p_user_id: user.id });
  if (error) return json({ error: error.message }, 400, req);

  const row = Array.isArray(data) ? data[0] : data;
  return json(row || { success: false }, 200, req);
});