import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, adminKey);

  const { data: { user }, error: userError } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await admin.from("profiles").select("role,display_name").eq("id", user.id).single();
  if (!profile || profile.role !== "owner") return json({ error: "Forbidden" }, 403);

  const [users, paid, orders, chats] = await Promise.all([
    admin.from("profiles").select("id,plan,role,created_at", { count: "exact", head: true }),
    admin.from("orders").select("id,amount", { count: "exact" }).eq("status", "paid"),
    admin.from("orders").select("amount,status,plan,created_at").order("created_at", { ascending: false }).limit(20),
    admin.from("conversations").select("id", { count: "exact", head: true }),
  ]);

  const revenue = (paid.data || []).reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);

  return json({
    owner: profile.display_name,
    users: users.count || 0,
    conversations: chats.count || 0,
    paidOrders: paid.count || 0,
    revenueVnd: revenue,
    recentOrders: orders.data || [],
  });
});
