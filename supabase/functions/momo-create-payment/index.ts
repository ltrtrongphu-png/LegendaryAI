import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmacSha256, base64Json, jsonResponse } from "../_shared/momo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function cors(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const PLAN = {
  pro: { amount: 299000, name: "Legendary AI Pro" },
  legendary: { amount: 899000, name: "Legendary AI Legendary" },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return cors({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const partnerCode = Deno.env.get("MOMO_PARTNER_CODE")!;
  const accessKey = Deno.env.get("MOMO_ACCESS_KEY")!;
  const secretKey = Deno.env.get("MOMO_SECRET_KEY")!;
  const siteUrl = Deno.env.get("SITE_URL")!;
  const momoEndpoint = Deno.env.get("MOMO_ENDPOINT") || "https://test-payment.momo.vn/v2/gateway/api/create";

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return cors({ error: "Unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return cors({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const planKey = body.plan as keyof typeof PLAN;
  const plan = PLAN[planKey];
  if (!plan) return cors({ error: "Invalid plan" }, 400);

  const orderId = "LAI_" + crypto.randomUUID().replaceAll("-", "").slice(0, 30);
  const requestId = crypto.randomUUID().replaceAll("-", "").slice(0, 32);
  const extraData = base64Json({ userId: user.id, plan: planKey });

  const { error: insertError } = await supabase.from("orders").insert({
    user_id: user.id,
    plan: planKey,
    amount: plan.amount,
    provider_order_id: orderId,
    provider_request_id: requestId,
    status: "pending",
  });
  if (insertError) return cors({ error: insertError.message }, 500);

  const redirectUrl = siteUrl + "/?payment=" + encodeURIComponent(orderId);
  const ipnUrl = supabaseUrl + "/functions/v1/momo-ipn";

  const signatureText =
    "accessKey=" + accessKey +
    "&amount=" + plan.amount +
    "&extraData=" + extraData +
    "&ipnUrl=" + ipnUrl +
    "&orderId=" + orderId +
    "&orderInfo=" + plan.name +
    "&partnerCode=" + partnerCode +
    "&redirectUrl=" + redirectUrl +
    "&requestId=" + requestId +
    "&requestType=captureWallet";

  const signature = await hmacSha256(secretKey, signatureText);

  const payload = {
    partnerCode,
    requestType: "captureWallet",
    ipnUrl,
    redirectUrl,
    orderId,
    amount: String(plan.amount),
    orderInfo: plan.name,
    requestId,
    extraData,
    lang: "vi",
    autoCapture: true,
    signature,
  };

  const response = await fetch(momoEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();

  if (!response.ok || result.resultCode !== 0) {
    await supabase.from("orders").update({
      status: "failed",
      provider_result_code: result.resultCode ?? -1,
      provider_message: result.message ?? "MoMo request failed",
    }).eq("provider_order_id", orderId);
    return cors({ error: result.message || "MoMo payment creation failed" }, 502);
  }

  return cors({
    orderId,
    payUrl: result.payUrl,
    qrCodeUrl: result.qrCodeUrl || null,
    deeplink: result.deeplink || null,
  });
});
