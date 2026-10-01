import assert from "node:assert/strict";
import fs from "node:fs";

const adapter=fs.readFileSync("supabase/functions/ai-chat-v10/huggingface-space.ts","utf8");
const runtime=fs.readFileSync("supabase/functions/ai-chat-v10/model-runtime.ts","utf8");
const migration=fs.readFileSync("supabase/migrations/20260930120000_huggingface_local_model_foundation_v1.sql","utf8");

assert.match(adapter,/HF_SPACE_URL/);
assert.match(adapter,/HF_SPACE_PROTOCOL/);
assert.match(adapter,/openai-compatible/);
assert.match(adapter,/gradio/);
assert.match(runtime,/MODEL_CAPABILITY_UNSUPPORTED/);
assert.match(runtime,/huggingface-local/);
assert.match(migration,/provider in \('local','ollama-compatible','huggingface-space'/);
assert.match(migration,/health_status/);
console.log("huggingface-local-foundation: ok");
