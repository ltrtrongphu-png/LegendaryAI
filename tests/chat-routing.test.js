const fs = require('fs');
const assert = require('assert/strict');

const source = fs.readFileSync('js/chat.js', 'utf8');
const match = source.match(
  /function\s+isImageGenerationPrompt\(text\)\s*\{\s*return\s+(.+?)\.test\(String\(text\s*\|\|\s*''\)\);/s
);

assert(match, 'image prompt classifier not found');
const classifier = eval(match[1]);

assert.equal(classifier.test('tạo ảnh con mèo full hd'), true);
assert.equal(classifier.test('vẽ một con mèo'), true);
assert.equal(classifier.test('create an image of a cat'), true);
assert.equal(classifier.test('tạo code plugin Paper 1.21.4'), false);

console.log('chat routing regression: PASS');
