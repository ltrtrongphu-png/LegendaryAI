import assert from 'node:assert/strict';
import { buildModelSystemPrompt, codeDiagnostics, convertUnits, createNativePlan, detectIntent, extractiveSummary, nativeAgent, nativeAnswer, safeMath } from '../supabase/functions/ai-chat-v10/brain-core.js';

const cases = [
  ['hi', 'greeting'],
  ['tạo ảnh con mèo full hd', 'image'],
  ['vẽ một con mèo', 'image'],
  ['tạo code plugin Paper 1.21.4', 'code'],
  ['Viết giúp tôi một email xin nghỉ phép lịch sự', 'writing'],
  ['2 + 2', 'math'],
];
for (const [input, expected] of cases) assert.equal(detectIntent(input), expected, `${input} should route to ${expected}`);

assert.equal(safeMath('2 + 2 * 5'), 12);
assert.equal(safeMath('10 ÷ 2'), 5);
assert.equal(nativeAnswer('hi').text, 'Xin chào 👋 Mình là LegendaryAI. Bạn muốn làm gì hôm nay?');
assert.equal(createNativePlan('10 km to m').version, '12.0');
assert.equal(createNativePlan('10 km to m').steps[0].tool, 'unit_convert');
assert.equal(nativeAgent('10 km to m').text, '10000');
assert.equal(nativeAgent('10 km to m').agent.verification.passed, true);
assert.equal(convertUnits('10 km to m'), 10000);
assert.equal(convertUnits('32 F to C'), 0);
assert.match(extractiveSummary('Alpha là một hệ thống. Beta là một hệ thống lớn. Gamma là một ghi chú.', 2), /hệ thống/);
assert.match(codeDiagnostics('debug ```js\nconst x = {\n```'), /chưa cân bằng|cân bằng/);
assert.equal(nativeAnswer('tạo ảnh con mèo full hd').action, 'image');
assert.match(nativeAnswer('tạo code plugin Paper 1.21.4').text, /text model/i);
assert.match(nativeAnswer('Viết giúp tôi một email xin nghỉ phép lịch sự').text, /Kính gửi/);
assert.doesNotMatch(nativeAnswer('tạo code plugin Paper 1.21.4').text, /Intent:|Keywords:|Constraints:|Self-check/i);
assert.doesNotMatch(buildModelSystemPrompt('').toLowerCase(), /chain-of-thought/);

console.log('brain native core: PASS');
