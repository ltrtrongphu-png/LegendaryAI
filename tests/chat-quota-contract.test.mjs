import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("supabase/functions/ai-chat-v10/index.ts", "utf8");
const startCache = source.indexOf("const cacheKey=await sha");
const endCache = source.indexOf("\nlet text=\"\";", startCache);
assert.ok(startCache >= 0 && endCache > startCache, "cache and generation sections must exist");
const cacheSection = source.slice(startCache, endCache);
const generationSection = source.slice(endCache);

assert.match(cacheSection, /userId:authData\.user\.id/, "shared cache entries must be isolated by authenticated user");
assert.match(cacheSection, /await admin\.rpc\("consume_tokens"/, "cache hits must debit token quota too");
assert.match(cacheSection, /input_tokens:cachedInputTokens/, "cache-hit usage must record input tokens");
assert.match(cacheSection, /approxTokens\(buildModelSystemPrompt\(system\)/, "cache-hit estimate must count system instructions and recalled memory");
assert.match(generationSection, /const inputTokens=approxTokens\(buildModelSystemPrompt\(system\)/, "fresh request estimate must count system instructions and recalled memory");
assert.match(cacheSection, /output_tokens:cachedOutputTokens/, "cache-hit usage must record output tokens");
assert.match(source, /const reservationPlan=planTokenReservation\(inputTokens,max,remaining\)/, "fresh responses must reserve an atomic, balance-capped token budget");
assert.match(generationSection, /localReservation=reservationPlan\.reservedTokens/, "reservation must become active only after successful RPC");
assert.match(generationSection, /const actual=inputTokens\+outputTokens/, "all engine routes must settle input/output token usage");
assert.match(generationSection, /text\.length>max\*4\)text=text\.slice\(0,max\*4\)/, "Native Core output must fit the token reservation");
assert.match(generationSection, /input_tokens:inputTokens,\s*output_tokens:outputTokens,\s*reserved_tokens:localReservation/, "usage logs must count Native Core and model routes consistently");
assert.match(source, /checkRateLimitBucket\(buckets,"user:"\+id,now,SHIELD_WINDOW_MS,SHIELD_MAX_REQUESTS,50\)/, "rate-limit keys must include an independent user bucket");
assert.match(source, /checkRateLimitBucket\(buckets,"ip:"\+ip,now,SHIELD_WINDOW_MS,SHIELD_MAX_REQUESTS,50\)/, "rate-limit keys must include an independent trusted-IP bucket");
assert.match(source, /cf-connecting-ip.*x-forwarded-for/, "edge-injected IP header must be preferred to caller-supplied forwarding headers");
assert.match(source, /let memorySaved=false/, "memory persistence result must start false");
assert.ok(
  source.indexOf("const actual=inputTokens+outputTokens") < source.indexOf("memorySaved=await maybeSaveExplicitMemory"),
  "explicit memory must not be persisted before a usable answer and quota settlement",
);
assert.match(source, /eq\("user_id",userId\)\.eq\("memory",memory\)/, "explicit memory saving must avoid exact duplicate rows");
console.log("chat-quota-contract: assertions passed");
