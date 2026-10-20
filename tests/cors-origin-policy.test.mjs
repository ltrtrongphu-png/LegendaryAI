import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync("supabase/functions/ai-chat-v10/index.ts", "utf8");
const health = readFileSync("supabase/functions/local-model-health/index.ts", "utf8");

for (const [name, source] of [["ai-chat-v10", chat], ["local-model-health", health]]) {
  assert.match(source, /ORIGIN_NOT_ALLOWED/, name + " must reject unapproved browser origins");
  assert.match(source, /SITE_URL/, name + " must support the configured production site origin");
}
assert.match(chat, /origin&&!ORIGINS\.has\(origin\)/, "chat handler must reject disallowed Origin before processing");
assert.match(health, /origin && !ORIGINS\.has\(origin\)/, "health handler must reject disallowed Origin before processing");
console.log("CORS origin allowlist regression: PASS");
