import assert from 'node:assert/strict';
import { buildModelSystemPrompt, detectIntent, nativeAnswer, safeMath } from '../supabase/functions/ai-chat-v10/brain-core.js';

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
assert.equal(nativeAnswer('tạo ảnh con mèo full hd').action, 'image');
assert.match(nativeAnswer('tạo code plugin Paper 1.21.4').text, /text model/i);
assert.match(nativeAnswer('Viết giúp tôi một email xin nghỉ phép lịch sự').text, /Kính gửi/);
assert.doesNotMatch(nativeAnswer('tạo code plugin Paper 1.21.4').text, /Intent:|Keywords:|Constraints:|Self-check/i);
assert.doesNotMatch(buildModelSystemPrompt('').toLowerCase(), /chain-of-thought/);

console.log('brain native core: PASS');
