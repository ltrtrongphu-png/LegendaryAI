import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });

  const auth = req.headers.get("Authorization");
  if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return new Response(JSON.stringify({ error: "Server configuration missing" }), { status: 503, headers: { "Content-Type": "application/json" } });

  const admin = createClient(url, key, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: userError } = await admin.auth.getUser();
  if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });

  const { data, error } = await admin.rpc("manual_reset_tokens");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { "Content-Type": "application/json" } });

  const row = Array.isArray(data) ? data[0] : data;
  return new Response(JSON.stringify(row || { success: false }), { status: 200, headers: { "Content-Type": "application/json" } });
});