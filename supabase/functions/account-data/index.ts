import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = new Set([
  "https://legendaryai.vercel.app",
  "https://www.legendaryai.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
if (siteUrl) ORIGINS.add(siteUrl);
const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function response(req: Request, body: unknown, status = 200) {
  const origin = req.headers.get("origin") || "";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      ...(ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Credentials": "true",
      "Vary": "Origin",
    },
  });
}

async function storageObjects(admin: any, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
  const found: string[] = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const { data, error } = await admin.storage.from("chat-attachments").list(prefix, { limit: 100, offset });
    if (error) throw new Error("STORAGE_LIST_FAILED");
    const rows = data || [];
    for (const item of rows) {
      const path = prefix ? prefix + "/" + item.name : item.name;
      if (item.id == null && item.metadata == null) found.push(...await storageObjects(admin, path, depth + 1));
      else found.push(path);
    }
    if (rows.length < 100) break;
  }
  return found;
}

function safeQueryError(error: unknown) {
  if (error) console.error("account-data database operation failed");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ORIGINS.has(origin)) return response(req, { error: "Origin not allowed", code: "ORIGIN_NOT_ALLOWED" }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...jsonHeaders, ...(ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}), "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", Vary: "Origin" } });
  if (req.method !== "POST") return response(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const auth = req.headers.get("Authorization") || "";
  const accessToken = auth.replace(/^Bearer\s+/i, "");
  if (!url || !serviceKey || !anonKey) return response(req, { error: "Server configuration missing", code: "SERVER_CONFIG" }, 503);
  if (!accessToken) return response(req, { error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
  const user = authData.user;
  if (authError || !user) return response(req, { error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

  let raw = "";
  let body: any;
  try {
    raw = await req.text();
    if (raw.length > 20000) return response(req, { error: "Payload too large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return response(req, { error: "Invalid JSON" }, 400);
  }

  const action = String(body?.action || "");
  if (action === "consent") {
    const version = String(body?.version || "1.0.0").slice(0, 32);
    if (!/^[a-zA-Z0-9._-]{1,32}$/.test(version)) return response(req, { error: "Invalid policy version" }, 400);
    const rows = [
      { user_id: user.id, policy_key: "terms", version, accepted_at: new Date().toISOString(), ip_hash: null },
      { user_id: user.id, policy_key: "privacy", version, accepted_at: new Date().toISOString(), ip_hash: null },
    ];
    const { error } = await admin.from("user_consents").upsert(rows, { onConflict: "user_id,policy_key,version", ignoreDuplicates: true });
    if (error) {
      safeQueryError(error);
      return response(req, { error: "Could not record consent", code: "CONSENT_WRITE_FAILED" }, 500);
    }
    return response(req, { ok: true, policyVersion: version });
  }

  if (action === "payment-status") {
    const orderId = String(body?.orderId || "");
    if (!/^LAI_[a-zA-Z0-9]{12,40}$/.test(orderId)) return response(req, { error: "Invalid order ID" }, 400);
    const { data: order, error } = await admin.from("orders")
      .select("provider_order_id,plan,amount,currency,status,created_at,paid_at,expires_at")
      .eq("provider_order_id", orderId).eq("user_id", user.id).maybeSingle();
    if (error) {
      safeQueryError(error);
      return response(req, { error: "Could not load payment status" }, 500);
    }
    if (!order) return response(req, { error: "Order not found", code: "ORDER_NOT_FOUND" }, 404);
    return response(req, { ok: true, order });
  }

  if (action === "export") {
    const queries = await Promise.all([
      admin.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      admin.from("conversations").select("*").eq("user_id", user.id).order("created_at").limit(5000),
      admin.from("messages").select("*").eq("user_id", user.id).order("created_at").limit(10000),
      admin.from("ai_memories").select("*").eq("user_id", user.id).order("created_at").limit(5000),
      admin.from("ai_usage_logs").select("*").eq("user_id", user.id).order("created_at").limit(10000),
      admin.from("orders").select("id,plan,amount,currency,provider,provider_order_id,status,provider_result_code,provider_message,paid_at,expires_at,created_at,updated_at").eq("user_id", user.id).order("created_at").limit(5000),
      admin.from("user_consents").select("policy_key,version,accepted_at,ip_hash").eq("user_id", user.id).order("accepted_at").limit(1000),
      admin.from("support_requests").select("id,contact_email,topic,message,status,created_at,updated_at").eq("user_id", user.id).order("created_at").limit(1000),
    ]);
    if (queries.some((q) => q.error)) {
      queries.forEach((q) => safeQueryError(q.error));
      return response(req, { error: "Data export could not be completed", code: "EXPORT_FAILED" }, 500);
    }

    let files: Array<{ path: string; signed_url: string | null; expires_in_seconds: number }> = [];
    try {
      const paths = await storageObjects(admin, user.id);
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const signed = await Promise.all(chunk.map(async (path) => {
          const { data } = await admin.storage.from("chat-attachments").createSignedUrl(path, 300);
          return { path, signed_url: data?.signedUrl || null, expires_in_seconds: 300 };
        }));
        files.push(...signed);
      }
    } catch {
      console.error("account-data file export failed");
      return response(req, { error: "Could not list stored attachments", code: "EXPORT_FILES_FAILED" }, 500);
    }

    return response(req, {
      ok: true,
      exported_at: new Date().toISOString(),
      export_note: "Attachment URLs expire after 5 minutes. This export is capped at the row limits documented in the service source.",
      email: user.email || null,
      profile: queries[0].data,
      conversations: queries[1].data || [],
      messages: queries[2].data || [],
      memories: queries[3].data || [],
      usage_logs: queries[4].data || [],
      orders: queries[5].data || [],
      consents: queries[6].data || [],
      support_requests: queries[7].data || [],
      attachments: files,
    });
  }

  if (action === "delete") {
    const password = String(body?.password || "");
    if (!user.email || !password || password.length > 1024) return response(req, { error: "Enter your account password to confirm deletion", code: "REAUTH_REQUIRED" }, 400);
    const reauth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: reauthError } = await reauth.auth.signInWithPassword({ email: user.email, password });
    await reauth.auth.signOut().catch(() => undefined);
    if (reauthError) return response(req, { error: "Password verification failed. Account was not deleted.", code: "REAUTH_FAILED" }, 401);

    const { data: pending, error: pendingError } = await admin.from("orders").select("id").eq("user_id", user.id).eq("status", "pending").limit(1);
    if (pendingError) {
      safeQueryError(pendingError);
      return response(req, { error: "Could not check pending payments. Account was not deleted.", code: "PENDING_PAYMENT_CHECK_FAILED" }, 500);
    }
    if (pending?.length) return response(req, { error: "Resolve pending payments before deleting this account.", code: "PENDING_PAYMENT" }, 409);

    let paths: string[];
    try { paths = await storageObjects(admin, user.id); }
    catch { return response(req, { error: "Could not verify stored files. Account was not deleted.", code: "STORAGE_CHECK_FAILED" }, 500); }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      safeQueryError(deleteError);
      return response(req, { error: "Account deletion failed. No attachment cleanup was attempted.", code: "ACCOUNT_DELETE_FAILED" }, 500);
    }

    let cleanupPending = false;
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from("chat-attachments").remove(paths.slice(i, i + 100));
      if (error) cleanupPending = true;
    }
    return response(req, {
      ok: true,
      account_deleted: true,
      retained_records: "Order history and policy-consent evidence are retained without the direct user_id link where database constraints allow it.",
      attachment_cleanup_pending: cleanupPending,
      message: cleanupPending ? "Account deleted; some stored files require manual cleanup." : "Account and user-associated files deleted.",
    });
  }

  return response(req, { error: "Unsupported action" }, 400);
});
