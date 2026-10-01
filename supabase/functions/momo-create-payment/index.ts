import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function base64Json(value: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

const configuredSiteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
const ORIGINS = new Set([
  "https://legendaryai.vercel.app",
  "https://www.legendaryai.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Credentials": "true",
};
function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    ...baseCorsHeaders,
    ...(ORIGINS.has(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : configuredSiteUrl
        ? { "Access-Control-Allow-Origin": configuredSiteUrl }
        : {}),
    "Vary": "Origin",
  };
}

function cors(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(req ? getCorsHeaders(req) : baseCorsHeaders) },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) });
  if (req.method !== "POST") return cors({ error: "Method not allowed" }, 405, req);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const partnerCode = Deno.env.get("MOMO_PARTNER_CODE")!;
  const accessKey = Deno.env.get("MOMO_ACCESS_KEY")!;
  const secretKey = Deno.env.get("MOMO_SECRET_KEY")!;
  const siteUrl = Deno.env.get("SITE_URL")!;
  const momoEndpoint = Deno.env.get("MOMO_ENDPOINT") || "https://test-payment.momo.vn/v2/gateway/api/create";

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return cors({ error: "Unauthorized" }, 401, req);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: { user }, error: userError } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (userError || !user) return cors({ error: "Unauthorized" }, 401, req);

  const body = await req.json().catch(() => ({}));
  const planKey = String(body.plan || "").trim().toLowerCase();
  const { data: plan, error: planError } = await admin
    .from("plans")
    .select("id,key,name,price_vnd,enabled,default_model_key")
    .eq("key", planKey)
    .eq("enabled", true)
    .maybeSingle();
  if (planError || !plan || Number(plan.price_vnd || 0) <= 0) {
    return cors({ error: "Gói không tồn tại, đang tắt hoặc không hỗ trợ thanh toán." }, 400, req);
  }

  const orderId = "LAI_" + crypto.randomUUID().replaceAll("-", "").slice(0, 30);
  const requestId = crypto.randomUUID().replaceAll("-", "").slice(0, 32);
  const extraData = base64Json({ userId: user.id, plan: planKey });

  const { data: modelForPlan } = await admin
    .from("ai_models")
    .select("provider,model_id,enabled")
    .eq("key", String((plan as any).default_model_key || ""))
    .maybeSingle();
  const localGateway = Deno.env.get("LEGENDARY_LOCAL_AI_URL") || "";
  if (!modelForPlan || !modelForPlan.enabled ||
      (modelForPlan.provider === "local" && !localGateway) ||
      (modelForPlan.provider === "ollama-compatible" && !localGateway)) {
    return cors({
      error: "Thanh toán gói trả phí đang tạm đóng vì AI model production chưa được bật. Không thu tiền khi tính năng chưa sẵn sàng.",
      code: "PAYMENT_TEMPORARILY_DISABLED"
    }, 503, req);
  }

  const { error: insertError } = await admin.from("orders").insert({
    user_id: user.id,
    plan: planKey,
    amount: plan.price_vnd,
    provider_order_id: orderId,
    provider_request_id: requestId,
    status: "pending",
  });
  if (insertError) return cors({ error: insertError.message }, 500, req);

  const redirectUrl = siteUrl + "/?payment=" + encodeURIComponent(orderId);
  const ipnUrl = supabaseUrl + "/functions/v1/momo-ipn";

  const signatureText =
    "accessKey=" + accessKey +
    "&amount=" + plan.price_vnd +
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
    amount: String(plan.price_vnd),
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
    await admin.from("orders").update({
      status: "failed",
      provider_result_code: result.resultCode ?? -1,
      provider_message: result.message ?? "MoMo request failed",
    }).eq("provider_order_id", orderId);
    return cors({ error: result.message || "MoMo payment creation failed" }, 502, req);
  }

  return cors({
    orderId,
    payUrl: result.payUrl,
    qrCodeUrl: result.qrCodeUrl || null,
    deeplink: result.deeplink || null,
  });
});
