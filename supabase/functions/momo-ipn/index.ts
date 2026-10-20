import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmacSha256, momoIpnSignatureText, timingSafeHexEqual } from "../_shared/momo.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
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

  const signatureText = momoIpnSignatureText(accessKey, body as Record<string, unknown>);

  const expected = await hmacSha256(secretKey, signatureText);
  if (!timingSafeHexEqual(body.signature, expected)) {
    return jsonResponse({ error: "Invalid signature" }, 401);
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id,user_id,plan,amount,status,provider_request_id,provider_transaction_id")
    .eq("provider_order_id", body.orderId)
    .single();

  if (orderError || !order) return jsonResponse({ error: "Order not found" }, 404);

  if (String(body.requestId) !== String(order.provider_request_id || "")) return jsonResponse({ error: "Request ID mismatch" }, 400);
  if (!order.user_id) return jsonResponse({ error: "Order is not associated with an active account" }, 409);

  if (Number(body.amount) !== Number(order.amount)) {
    return jsonResponse({ error: "Amount mismatch" }, 400);
  }

  const success = Number(body.resultCode) === 0;
  // A successful callback must prove the user/plan binding from signed extraData.
  // Some failed/rejected callbacks may omit extraData; they never activate a plan.
  if (success || body.extraData) {
    try {
      const encoded = String(body.extraData || "");
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const extra = JSON.parse(new TextDecoder().decode(bytes));
      if (extra.userId !== order.user_id || extra.plan !== order.plan) return jsonResponse({ error: "Order metadata mismatch" }, 400);
    } catch {
      return jsonResponse({ error: "Invalid order metadata" }, 400);
    }
  }
  const paidAt = success ? new Date().toISOString() : null;

  const { data: finalized, error: finalizeError } = await supabase.rpc("finalize_momo_payment", {
    p_order_id: order.id,
    p_request_id: String(body.requestId),
    p_provider_transaction_id: String(body.transId),
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
