import assert from 'node:assert/strict';

const source = await import('../supabase/functions/ai-chat-v10/model-runtime.ts');

const model = {
  key: 'test-local',
  provider: 'ollama-compatible',
  model_id: 'qwen3:30b',
  supports_streaming: false,
  supports_vision: true,
  supports_tools: false,
  supports_json: true,
  supports_system_prompt: true,
  capabilities: ['chat', 'vision', 'json', 'system_prompt']
};

assert.equal(source.hasCapability(model, 'vision'), true);
assert.equal(source.hasCapability(model, 'tools'), false);
assert.deepEqual(source.negotiateCapability(model, 'vision', { vision: true }), { ok: true });
assert.deepEqual(source.negotiateCapability(model, 'tools', { tools: true }), {
  ok: false,
  code: 'MODEL_CAPABILITY_UNSUPPORTED'
});
assert.deepEqual(source.negotiateCapability(model, 'project', { projectWorkspace: false }), {
  ok: false,
  code: 'CAPABILITY_FORBIDDEN'
});

const error = source.modelError('MODEL_TIMEOUT', 'gateway timed out');
assert.equal(error.code, 'MODEL_TIMEOUT');
assert.equal(error.message, 'gateway timed out');
assert.match(source.requestId(), /^[0-9a-f-]{36}$/i);

const bounded = source.planTokenReservation(90, 500, 350, 256);
assert.deepEqual(bounded, { ok: true, inputTokens: 90, outputTokens: 260, reservedTokens: 350 });
assert.deepEqual(source.planTokenReservation(100, 500, 355, 256), {
  ok: false,
  code: 'TOKEN_LIMIT',
  inputTokens: 100,
  outputTokens: 0,
  reservedTokens: 0
});
assert.deepEqual(source.planTokenReservation(12, 128, 1000, 256), {
  ok: false,
  code: 'TOKEN_LIMIT',
  inputTokens: 12,
  outputTokens: 0,
  reservedTokens: 0
});

const buckets = new Map();
assert.equal(source.checkRateLimitBucket(buckets, 'user:a', 1000, 60000, 3, 50).ok, true);
assert.equal(source.checkRateLimitBucket(buckets, 'ip:192.0.2.10', 1000, 60000, 3, 50).ok, true);
assert.equal(source.checkRateLimitBucket(buckets, 'user:a', 1020, 60000, 3, 50).code, 'REQUEST_BURST');
assert.equal(source.checkRateLimitBucket(buckets, 'user:a', 1051, 60000, 3, 50).ok, true);
assert.equal(source.checkRateLimitBucket(buckets, 'user:a', 1102, 60000, 3, 50).ok, true);
assert.equal(source.checkRateLimitBucket(buckets, 'user:a', 1153, 60000, 3, 50).code, 'RATE_LIMITED');
assert.equal(source.checkRateLimitBucket(buckets, 'user:b', 1153, 60000, 3, 50).ok, true, 'one user must not exhaust another user bucket');

console.log('model-runtime contract: PASS');
