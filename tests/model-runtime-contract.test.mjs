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

console.log('model-runtime contract: PASS');
