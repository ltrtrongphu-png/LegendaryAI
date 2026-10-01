import assert from 'node:assert/strict';
import { analyzeEmotion, applyEmpathyPrefix, buildCognitivePlan, composeTone, rankIntentCandidates, resolveContext } from '../supabase/functions/ai-chat-v10/cognitive-core.js';

assert.equal(analyzeEmotion('mẹ ơi lỗi này không chạy!!!').primary, 'frustration');
assert.equal(analyzeEmotion('không hiểu cái này').primary, 'confusion');
assert.ok(analyzeEmotion('ừ hay quá ha').sarcasm_likelihood > 0.6);

const context = resolveContext('sửa nó đi', [
  {role:'user',content:'Mình đang sửa login Supabase'},
  {role:'assistant',content:'Bạn kiểm tra session nhé'}
]);
assert.equal(context.references[0].target, 'Mình đang sửa login Supabase');

const ranked = rankIntentCandidates('viết giúp tôi email xin nghỉ phép');
assert.equal(ranked[0].intent, 'writing');
assert.ok(ranked[0].confidence >= 0.68);

const plan = buildCognitivePlan('không chạy được code này!!!', [{role:'user',content:'đang sửa JavaScript'}]);
assert.equal(plan.intent, 'code');
assert.equal(plan.emotion.primary, 'frustration');
assert.equal(plan.constraints.bounded, true);

assert.equal(composeTone(plan).tone, 'calm-direct');
assert.match(applyEmpathyPrefix('Mình sẽ kiểm tra lỗi.', plan), /^Mình hiểu/);

console.log('cognitive core v2: PASS');
