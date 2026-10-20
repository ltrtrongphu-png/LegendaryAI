import { createClient } from "npm:@supabase/supabase-js@2";

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function listOldObjects(admin: any, prefix: string, cutoff: Date, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
  const result: string[] = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const { data, error } = await admin.storage.from("chat-attachments").list(prefix, { limit: 100, offset });
    if (error) throw new Error("STORAGE_LIST_FAILED");
    const rows = data || [];
    for (const item of rows) {
      const path = prefix ? prefix + "/" + item.name : item.name;
      if (item.id == null && item.metadata == null) result.push(...await listOldObjects(admin, path, cutoff, depth + 1));
      else if (item.created_at && new Date(item.created_at) < cutoff) result.push(path);
    }
    if (rows.length < 100) break;
  }
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  const expected = Deno.env.get("RETENTION_CLEANUP_SECRET") || "";
  const supplied = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || !safeEqual(expected, supplied)) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return new Response(JSON.stringify({ error: "Server configuration missing" }), { status: 503 });

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: settings, error: settingsError } = await admin.from("retention_settings").select("key,retention_days,enabled");
  if (settingsError) return new Response(JSON.stringify({ error: "Retention configuration unavailable" }), { status: 500 });
  const policies = (settings || []).filter((x) => x.enabled && Number.isInteger(x.retention_days) && x.retention_days > 0);
  const deleted: Record<string, number> = {};

  for (const policy of policies) {
    const cutoffDate = new Date(Date.now() - policy.retention_days * 86400000);
    const cutoff = cutoffDate.toISOString();
    if (policy.key === "chat") {
      const { data, error } = await admin.from("conversations").delete().lt("updated_at", cutoff).select("id");
      if (error) return new Response(JSON.stringify({ error: "Chat retention cleanup failed" }), { status: 500 });
      deleted.conversations = data?.length || 0;
    } else if (policy.key === "usage_logs") {
      const { data, error } = await admin.from("ai_usage_logs").delete().lt("created_at", cutoff).select("id");
      if (error) return new Response(JSON.stringify({ error: "Usage-log retention cleanup failed" }), { status: 500 });
      deleted.usage_logs = data?.length || 0;
    } else if (policy.key === "memories") {
      const { data, error } = await admin.from("ai_memories").delete().lt("created_at", cutoff).select("id");
      if (error) return new Response(JSON.stringify({ error: "Memory retention cleanup failed" }), { status: 500 });
      deleted.memories = data?.length || 0;
    } else if (policy.key === "support_requests") {
      const { data, error } = await admin.from("support_requests").delete().lt("created_at", cutoff).select("id");
      if (error) return new Response(JSON.stringify({ error: "Support retention cleanup failed" }), { status: 500 });
      deleted.support_requests = data?.length || 0;
    } else if (policy.key === "attachments") {
      try {
        const { data: roots, error } = await admin.storage.from("chat-attachments").list("", { limit: 1000 });
        if (error) throw error;
        const stale: string[] = [];
        for (const item of roots || []) {
          if (item.id == null && item.metadata == null) stale.push(...await listOldObjects(admin, item.name, cutoffDate));
          else if (item.created_at && new Date(item.created_at) < cutoffDate) stale.push(item.name);
        }
        let count = 0;
        for (let i = 0; i < stale.length; i += 100) {
          const { data, error: removeError } = await admin.storage.from("chat-attachments").remove(stale.slice(i, i + 100));
          if (removeError) throw removeError;
          count += data?.length || 0;
        }
        deleted.attachments = count;
      } catch {
        console.error("attachment retention cleanup failed");
        return new Response(JSON.stringify({ error: "Attachment retention cleanup failed" }), { status: 500 });
      }
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    executed_at: new Date().toISOString(),
    active_policies: policies.map((x) => x.key),
    deleted,
    note: "No deletion occurs when enabled=false or retention_days is null. A protected scheduled invocation must be configured separately.",
  }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
});
