import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = new Set([
  "https://legendaryai.vercel.app",
  "https://www.legendaryai.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const configuredSiteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
if (configuredSiteUrl) ORIGINS.add(configuredSiteUrl);

function headers(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    ...(ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers(req) },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ORIGINS.has(origin)) return json(req, { error: "Origin not allowed", code: "ORIGIN_NOT_ALLOWED" }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !serviceKey) return json(req, { error: "Server configuration missing", code: "SERVER_CONFIG" }, 503);
  if (!token) return json(req, { error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  const admin = createClient(supabaseUrl, serviceKey);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json(req, { error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

  return json(req, {
    error: "Tính năng tạo ảnh đang tạm tắt vì chưa có dịch vụ tạo ảnh tự host được xác minh. Prompt không được gửi tới nhà cung cấp AI bên ngoài.",
    code: "IMAGE_GENERATION_DISABLED",
  }, 503);
});
