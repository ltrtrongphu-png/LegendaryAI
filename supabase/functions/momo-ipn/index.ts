import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmacSha256, jsonResponse } from "../_shared/momo.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => null);
  if (!body) return jsonResponse({ error: "Invalid JSON" }, 400);

  const accessKey = Deno.env.get("MOMO_ACCESS_KEY")!;
  const secretKey = Deno.env.get("MOMO_SECRET_KEY")!;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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
  if (!body.signature || body.signature !== expected) {
    return jsonResponse({ error: "Invalid signature" }, 401);
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id,user_id,plan,amount,status")
    .eq("provider_order_id", body.orderId)
    .single();

  if (orderError || !order) return jsonResponse({ error: "Order not found" }, 404);

  const success = Number(body.resultCode) === 0;
  const update = {
    status: success ? "paid" : "failed",
    provider_result_code: Number(body.resultCode),
    provider_message: body.message || null,
    paid_at: success ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  await supabase.from("orders").update(update).eq("id", order.id);

  if (success) {
    const limits: Record<string, number> = { pro: 300000, legendary: 1000000 };
    await supabase.from("profiles").update({
      plan: order.plan,
      token_limit: limits[order.plan] || 250000,
      tokens_used: 0,
      token_reset_at: new Date(Date.now() + 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", order.user_id);
  }

  // MoMo expects HTTP 200 from a successfully processed IPN.
  return jsonResponse({ resultCode: 0, message: "received" });
});
