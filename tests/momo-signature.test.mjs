import { hmacSha256, momoCreateSignatureText, momoIpnSignatureText, timingSafeHexEqual } from "../supabase/functions/_shared/momo.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(message + "\nactual: " + String(actual) + "\nexpected: " + String(expected));
}

Deno.test("MoMo payment-init signature canonical order matches the fixed test vector", async () => {
  const text = momoCreateSignatureText({
    accessKey: "ak",
    amount: 10000,
    extraData: "e",
    ipnUrl: "https://example.test/ipn",
    orderId: "OID",
    orderInfo: "Pro",
    partnerCode: "PC",
    redirectUrl: "https://example.test/payment",
    requestId: "RID",
    requestType: "captureWallet",
  });
  assertEquals(
    text,
    "accessKey=ak&amount=10000&extraData=e&ipnUrl=https://example.test/ipn&orderId=OID&orderInfo=Pro&partnerCode=PC&redirectUrl=https://example.test/payment&requestId=RID&requestType=captureWallet",
    "payment-init canonical fields/order must stay stable",
  );
  assertEquals(
    await hmacSha256("secret", text),
    "9a099867d21ed86a294c74b08300566d852ce0607201cd3dc4195109a74fcedb",
    "payment-init HMAC vector changed",
  );
});

Deno.test("MoMo captureWallet IPN signature canonical order matches the fixed test vector", async () => {
  const body = {
    amount: 10000,
    extraData: "e",
    message: "Success",
    orderId: "OID",
    orderInfo: "Pro",
    orderType: "momo_wallet",
    partnerCode: "PC",
    payType: "qr",
    requestId: "RID",
    responseTime: "1720000000000",
    resultCode: 0,
    transId: "TX1",
  };
  const text = momoIpnSignatureText("ak", body);
  assertEquals(
    text,
    "accessKey=ak&amount=10000&extraData=e&message=Success&orderId=OID&orderInfo=Pro&orderType=momo_wallet&partnerCode=PC&payType=qr&requestId=RID&responseTime=1720000000000&resultCode=0&transId=TX1",
    "IPN canonical fields/order must stay stable",
  );
  assertEquals(
    await hmacSha256("secret", text),
    "b577e3de249e1be3b150cf4401766686e781195a8fde460921e5bfc3af698a14",
    "IPN HMAC vector changed",
  );
});

Deno.test("MoMo hex signature comparison handles case and rejects edits/length changes", () => {
  const signature = "b577e3de249e1be3b150cf4401766686e781195a8fde460921e5bfc3af698a14";
  if (!timingSafeHexEqual(signature.toUpperCase(), signature)) throw new Error("same digest should compare equal case-insensitively");
  if (timingSafeHexEqual(signature, signature.slice(0, -1) + "0")) throw new Error("modified digest must be rejected");
  if (timingSafeHexEqual(signature, signature.slice(1))) throw new Error("different lengths must be rejected");
});
