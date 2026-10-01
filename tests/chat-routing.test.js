const fs = require('fs');
const assert = require('assert/strict');

const source = fs.readFileSync('js/main.js', 'utf8');
const match = source.match(/function\s+isImageGenerationPrompt\(text\)\s*\{([\s\S]*?)\n\s*\}/);
assert(match, 'image prompt classifier not found');
const classifier = eval('(' + match[0] + ')');

assert.equal(classifier('tạo ảnh con mèo full hd'), true);
assert.equal(classifier('vẽ một con mèo'), true);
assert.equal(classifier('create an image of a cat'), true);
assert.equal(classifier('tạo code plugin Paper 1.21.4'), false);
assert.equal(classifier('viết giúp tôi một email xin nghỉ phép'), false);

console.log('chat routing regression: PASS');
