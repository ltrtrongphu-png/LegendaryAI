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
if (configuredSiteUrl) ORIGINS.add(configuredSiteUrl);
const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Credentials": "true",
};
function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    ...baseCorsHeaders,
    ...(ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
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
  const origin = req.headers.get("origin") || "";
  if (origin && !ORIGINS.has(origin)) return new Response(JSON.stringify({ error: "Origin not allowed", code: "ORIGIN_NOT_ALLOWED" }), { status: 403, headers: { "Content-Type": "application/json; charset=utf-8", Vary: "Origin" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) });
  if (req.method !== "POST") return cors({ error: "Method not allowed" }, 405, req);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const partnerCode = Deno.env.get("MOMO_PARTNER_CODE") || "";
  const accessKey = Deno.env.get("MOMO_ACCESS_KEY") || "";
  const secretKey = Deno.env.get("MOMO_SECRET_KEY") || "";
  const siteUrl = Deno.env.get("SITE_URL") || "";
  const momoEndpoint = Deno.env.get("MOMO_ENDPOINT") || "";

  if (!supabaseUrl || !serviceKey || !partnerCode || !accessKey || !secretKey || !siteUrl || !momoEndpoint) return cors({ error: "MoMo payment is not configured.", code: "PAYMENT_CONFIG_MISSING" }, 503, req);

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
  if (planError || !plan || !["pro", "legendary"].includes(planKey) || Number(plan.price_vnd || 0) < 1000 || Number(plan.price_vnd || 0) > 50000000) {
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
  const localGateway = (Deno.env.get("LEGENDARY_LOCAL_AI_URL") || "").replace(/\/$/, "");
  const localGatewayToken = Deno.env.get("LEGENDARY_LOCAL_AI_TOKEN") || "";
  if (!modelForPlan || !modelForPlan.enabled) {
    return cors({
      error: "Thanh toán gói trả phí đang tạm đóng vì AI model production chưa được bật. Không thu tiền khi tính năng chưa sẵn sàng.",
      code: "PAYMENT_TEMPORARILY_DISABLED"
    }, 503, req);
  }

  if (modelForPlan.provider === "local" || modelForPlan.provider === "ollama-compatible") {
    if (!localGateway || !localGatewayToken) {
      return cors({ error: "Model tự host chưa được cấu hình đầy đủ; thanh toán đang tạm đóng.", code: "PAYMENT_MODEL_NOT_CONFIGURED" }, 503, req);
    }
    const healthController = new AbortController();
    const healthTimer = setTimeout(() => healthController.abort(), 4000);
    try {
      const healthResponse = await fetch(localGateway + "/api/tags", {
        headers: { Authorization: "Bearer " + localGatewayToken },
        signal: healthController.signal
      });
      if (!healthResponse.ok) throw new Error("MODEL_GATEWAY_UNHEALTHY");
      const payload: any = await healthResponse.json();
      const models = Array.isArray(payload?.models) ? payload.models : [];
      const desired = String(modelForPlan.model_id || "").trim();
      const modelPresent = desired && models.some((item: any) => {
        const name = String(item?.name || item?.model || "").trim();
        return name === desired || name === desired + ":latest";
      });
      if (!modelPresent) throw new Error("MODEL_NOT_INSTALLED");
    } catch {
      console.error("momo-create-payment: selected model readiness check failed");
      return cors({ error: "Model đang không sẵn sàng; chưa tạo đơn thanh toán. Vui lòng thử lại sau.", code: "PAYMENT_MODEL_UNAVAILABLE" }, 503, req);
    } finally {
      clearTimeout(healthTimer);
    }
  }

  const { error: insertError } = await admin.from("orders").insert({
    user_id: user.id,
    plan: planKey,
    amount: plan.price_vnd,
    provider_order_id: orderId,
    provider_request_id: requestId,
    status: "pending",
  });
  if (insertError) { console.error("momo-create-payment: order insert failed"); return cors({ error: "Không thể tạo đơn thanh toán.", code: "ORDER_CREATE_FAILED" }, 500, req); }

  const redirectUrl = siteUrl.replace(/\/$/, "") + "/payment-result?payment=" + encodeURIComponent(orderId);
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  let response: Response;
  let result: any;
  try {
    response = await fetch(momoEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
    result = await response.json();
  } catch (error) {
    // The provider may have accepted the order even if its response timed out. Keep it pending for signed IPN/reconciliation.
    console.error("momo-create-payment: provider request failed", error instanceof Error && error.name === "AbortError" ? "timeout" : "network");
    return cors({ error: "MoMo chưa trả kết quả xác nhận. Đơn đang chờ đối soát; vui lòng kiểm tra trạng thái trước khi thanh toán lại.", code: error instanceof Error && error.name === "AbortError" ? "PAYMENT_PROVIDER_TIMEOUT" : "PAYMENT_PROVIDER_UNREACHABLE", orderId }, 504, req);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok || result.resultCode !== 0) {
    await admin.from("orders").update({
      status: "failed",
      provider_result_code: result.resultCode ?? -1,
      provider_message: result.message ?? "MoMo request failed",
    }).eq("provider_order_id", orderId);
    return cors({ error: "MoMo không thể tạo giao dịch. Vui lòng thử lại sau.", code: "PAYMENT_PROVIDER_REJECTED" }, 502, req);
  }

  return cors({
    orderId,
    payUrl: result.payUrl,
    qrCodeUrl: result.qrCodeUrl || null,
    deeplink: result.deeplink || null,
  });
});
