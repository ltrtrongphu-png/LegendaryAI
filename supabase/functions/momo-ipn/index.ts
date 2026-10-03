import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const aa = String(a || "").toLowerCase();
  const bb = String(b || "").toLowerCase();
  const max = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < max; i++) {
    diff |= (aa.charCodeAt(i) || 0) ^ (bb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const accessKey = Deno.env.get("MOMO_ACCESS_KEY") || "";
  const secretKey = Deno.env.get("MOMO_SECRET_KEY") || "";
  const configuredPartnerCode = Deno.env.get("MOMO_PARTNER_CODE") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  // Never accept or verify an IPN when the signing configuration is incomplete.
  // In particular, HMAC over the literal string "undefined" must never be valid.
  if (!accessKey || !secretKey || !configuredPartnerCode || !supabaseUrl || !serviceRoleKey) {
    console.error("momo-ipn: required server configuration is missing");
    return jsonResponse({ error: "Payment service is temporarily unavailable" }, 503);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonResponse({ error: "Invalid JSON" }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (body.partnerCode !== configuredPartnerCode) {
    return jsonResponse({ error: "Invalid partnerCode" }, 401);
  }

  const requiredFields = [
    "amount", "message", "orderId", "orderInfo", "orderType", "payType",
    "requestId", "responseTime", "resultCode", "transId", "signature"
  ];
  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null) {
      return jsonResponse({ error: `Missing IPN field: ${field}` }, 400);
    }
  }

  const signatureText =
    "accessKey=" + accessKey +
    "&amount=" + body.amount +
    "&extraData=" + (body.extraData || "") +
    "&message=" + body.message +
    "&orderId=" + body.orderId +
    "&orderInfo=" + body.orderInfo +
    "&orderType=" + body.orderType +
    "&partnerCode=" + body.partnerCode +
    "&payType=" + body.payType +
    "&requestId=" + body.requestId +
    "&responseTime=" + body.responseTime +
    "&resultCode=" + body.resultCode +
    "&transId=" + body.transId;

  const expected = await hmacSha256(secretKey, signatureText);
  if (!timingSafeHexEqual(body.signature, expected)) {
    return jsonResponse({ error: "Invalid signature" }, 401);
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id,user_id,plan,amount,status")
    .eq("provider_order_id", body.orderId)
    .single();

  if (orderError || !order) return jsonResponse({ error: "Order not found" }, 404);

  if (Number(body.amount) !== Number(order.amount)) {
    return jsonResponse({ error: "Amount mismatch" }, 400);
  }

  const success = Number(body.resultCode) === 0;
  const paidAt = success ? new Date().toISOString() : null;

  const { data: finalized, error: finalizeError } = await supabase.rpc("finalize_momo_payment", {
    p_order_id: order.id,
    p_success: success,
    p_result_code: Number(body.resultCode),
    p_message: body.message || null,
    p_paid_at: paidAt,
  });

  if (finalizeError || !finalized?.ok) {
    console.error("MoMo finalize failed", finalizeError?.message || finalized);
    return jsonResponse({ error: "Payment finalization failed" }, 500);
  }

  return jsonResponse({
    resultCode: 0,
    message: finalized.already_processed ? "already processed" : "received"
  });
});
