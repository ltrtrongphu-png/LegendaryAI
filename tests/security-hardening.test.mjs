import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20261020120000_legal_payment_retention_hardening.sql");
const schema = read("supabase/schema.sql");
const chat = read("supabase/functions/ai-chat-v10/index.ts");
const legacyChat = read("supabase/functions/ai-chat/index.ts");
const retiredChat = read("supabase/functions/ai-chat-v9/index.ts");
const health = read("supabase/functions/local-model-health/index.ts");
const createPayment = read("supabase/functions/momo-create-payment/index.ts");
const ipn = read("supabase/functions/momo-ipn/index.ts");
const image = read("supabase/functions/image-generate/index.ts");
const accountData = read("supabase/functions/account-data/index.ts");
const momoShared = read("supabase/functions/_shared/momo.ts");
const momoCreate = read("supabase/functions/momo-create-payment/index.ts");
const momoIpn = read("supabase/functions/momo-ipn/index.ts");

assert.match(migration, /create or replace function public\.finalize_momo_payment\s*\(/i, "MoMo finalizer must exist in the forward migration");
assert.match(migration, /for update/i, "MoMo finalizer must lock an order row");
assert.match(migration, /provider_transaction_id_uidx/i, "provider transaction idempotency index is required");
assert.match(migration, /create table if not exists public\.token_refunds/i, "refund idempotency ledger must exist");
assert.match(migration, /revoke all on function public\.refund_tokens\(integer, uuid\) from public, anon, authenticated, service_role/i, "legacy non-idempotent refund RPC must be disabled");
assert.match(migration, /grant execute on function public\.refund_tokens\(integer, uuid, text, integer\) to service_role/i, "only service role can use idempotent refund RPC");
assert.match(migration, /revoke all on function public\.consume_tokens\(integer, uuid, boolean\) from public, anon, authenticated/i, "client roles cannot reserve tokens directly");
assert.match(migration, /add column if not exists expires_at timestamptz/i, "payment finalizer order expiry column must exist");
assert.match(migration, /function public\.finalize_tokens_for_user\s*\(\s*p_user_id uuid,\s*p_reserved integer,\s*p_actual integer/i, "legacy service-role settlement needs explicit user ID");
assert.match(migration, /grant execute on function public\.finalize_tokens_for_user\(uuid, integer, integer\) to service_role/i, "only service role can settle legacy usage");
assert.match(legacyChat, /rpc\("finalize_tokens_for_user"/i, "legacy chat must use the explicit-user settlement RPC");
assert.match(schema, /drop policy if exists "ai models owner write"/i, "schema must explicitly reapply model-write authorization");
assert.match(schema, /p\.id = \(select auth\.uid\(\)\) and p\.role = 'owner'/i, "Owner model policies should use a stable initplan");
assert.doesNotMatch(schema, /ltrtrongphu@gmail\.com/i, "Owner privilege must not be granted by matching an email address");

for (const [label, src] of [["active chat", chat], ["legacy chat", legacyChat], ["model health", health], ["MoMo create", createPayment], ["Owner", read("supabase/functions/owner-admin/index.ts")], ["Owner stats", read("supabase/functions/owner-stats/index.ts")], ["token reset", read("supabase/functions/token-reset/index.ts")]]) {
  assert.match(src, /ORIGIN_NOT_ALLOWED/, label + " must reject unapproved origins");
  assert.match(src, /SITE_URL/, label + " must support configured SITE_URL");
}
assert.match(retiredChat, /CHAT_ROUTE_RETIRED/, "retired ai-chat-v9 must fail closed");
assert.match(retiredChat, /ORIGIN_NOT_ALLOWED/, "retired ai-chat-v9 must not echo arbitrary Origin values");
assert.match(chat, /LEGENDARY_LOCAL_AI_TOKEN/, "local inference must use the server-side bearer token");
assert.match(chat, /MODEL_UNAVAILABLE/, "explicit local-model selection must not be silently relabelled as Native Core");
assert.match(chat, /remaining<inputTokens\+256/, "generation must be bounded by remaining token budget");
assert.match(chat, /p_request_id:reservationId,p_reserved:localReservation/, "active chat refunds must be request-scoped");
assert.match(legacyChat, /p_request_id: reservationId, p_reserved: reservation/, "legacy chat must use the current refund contract");
assert.match(health, /Authorization: `Bearer \$\{gatewayToken\}`/, "health check must authenticate to the private gateway");

assert.match(createPayment, /AbortController/, "MoMo provider call must time out");
assert.match(createPayment, /LEGENDARY_LOCAL_AI_TOKEN/, "paid checkout must require the private model gateway secret");
assert.match(createPayment, /\/api\/tags/, "paid checkout must verify live model gateway readiness");
assert.match(momoShared, /momoCreateSignatureText/, "MoMo create signature must use shared canonicalization");
assert.match(momoShared, /momoIpnSignatureText/, "MoMo IPN signature must use shared canonicalization");
assert.match(momoShared, /timingSafeHexEqual/, "MoMo signature comparisons must use the constant-work helper");
assert.match(momoCreate, /momoCreateSignatureText\(/, "payment creation must use tested canonical signature text");
assert.match(momoIpn, /momoIpnSignatureText\(/, "IPN verification must use tested canonical signature text");
assert.match(momoIpn, /timingSafeHexEqual\(/, "IPN verification must use timing-safe comparison");
assert.match(createPayment, /PAYMENT_MODEL_UNAVAILABLE/, "paid checkout must fail closed when model is unavailable");
assert.doesNotMatch(createPayment, /MOMO_ENDPOINT.*test-payment\.momo\.vn/, "payment endpoint must not silently default to MoMo sandbox");
assert.match(ipn, /body\.requestId.*order\.provider_request_id|body\.requestId\) !== String\(order\.provider_request_id/, "IPN must bind requestId to persisted order");
assert.match(ipn, /Order metadata mismatch/, "successful IPN must bind signed user/plan metadata");
assert.match(ipn, /p_provider_transaction_id/, "finalizer must receive provider transaction ID");
assert.match(image, /IMAGE_GENERATION_DISABLED/, "image endpoint must fail closed until provider readiness");
assert.doesNotMatch(image, /OPENAI_API_KEY|api\.openai\.com/i, "image endpoint must not call the external OpenAI provider");

assert.match(accountData, /admin\.auth\.getUser\(accessToken\)/, "account actions must authenticate the caller");
assert.match(accountData, /admin\.auth\.admin\.deleteUser\(user\.id\)/, "account deletion must use server-side admin operation");
assert.match(accountData, /signInWithPassword/, "account deletion requires reauthentication");
assert.match(accountData, /action\s*===\s*["\u0027]export["\u0027]/, "data export endpoint must exist");
console.log("security-hardening: assertions passed");
