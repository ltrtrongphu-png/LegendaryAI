export async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type MomoCreateSignatureInput = {
  accessKey: string;
  amount: string | number;
  extraData: string;
  ipnUrl: string;
  orderId: string;
  orderInfo: string;
  partnerCode: string;
  redirectUrl: string;
  requestId: string;
  requestType: string;
};

/** Canonical field order for MoMo's standard payment-init request signature. */
export function momoCreateSignatureText(input: MomoCreateSignatureInput): string {
  return "accessKey=" + input.accessKey +
    "&amount=" + input.amount +
    "&extraData=" + input.extraData +
    "&ipnUrl=" + input.ipnUrl +
    "&orderId=" + input.orderId +
    "&orderInfo=" + input.orderInfo +
    "&partnerCode=" + input.partnerCode +
    "&redirectUrl=" + input.redirectUrl +
    "&requestId=" + input.requestId +
    "&requestType=" + input.requestType;
}

/** Canonical field order used by the current captureWallet IPN callback. */
export function momoIpnSignatureText(accessKey: string, body: Record<string, unknown>): string {
  return "accessKey=" + accessKey +
    "&amount=" + String(body.amount) +
    "&extraData=" + String(body.extraData || "") +
    "&message=" + String(body.message) +
    "&orderId=" + String(body.orderId) +
    "&orderInfo=" + String(body.orderInfo) +
    "&orderType=" + String(body.orderType) +
    "&partnerCode=" + String(body.partnerCode) +
    "&payType=" + String(body.payType) +
    "&requestId=" + String(body.requestId) +
    "&responseTime=" + String(body.responseTime) +
    "&resultCode=" + String(body.resultCode) +
    "&transId=" + String(body.transId);
}

/** Compare hexadecimal signatures without an early exit on the first mismatch. */
export function timingSafeHexEqual(a: string, b: string): boolean {
  const aa = String(a || "").toLowerCase();
  const bb = String(b || "").toLowerCase();
  const max = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < max; i++) {
    diff |= (aa.charCodeAt(i) || 0) ^ (bb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function base64Json(value: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
