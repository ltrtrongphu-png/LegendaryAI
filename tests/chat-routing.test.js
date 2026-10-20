const fs = require('fs');
const assert = require('assert/strict');

const mainSource = fs.readFileSync('js/main.js', 'utf8');
const chatSource = fs.readFileSync('js/chat.js', 'utf8');

// The old capture-phase image-routing hotfix was intentionally removed so
// chat.js remains the single routing authority.
assert.doesNotMatch(mainSource, /capture\s*:\s*true/i, 'legacy capture-phase routing hotfix must stay removed');
assert.doesNotMatch(mainSource, /addEventListener\([^)]*submit[^)]*capture/i, 'main.js must not intercept chat submit in capture phase');

// The classifier now lives in chat.js. Keep regression coverage for the
// important distinction between image requests and diagram/code requests.
assert.match(chatSource, /(?:vẽ|draw)/i, 'chat classifier must handle draw intent');
assert.match(chatSource, /(?:diagram|mermaid|flowchart|kiến trúc)/i, 'chat classifier must protect diagram/code requests');
assert.match(chatSource, /(?:ảnh|hình|image|picture|illustration|logo|poster)/i, 'chat classifier must recognize image nouns');

console.log('chat routing regression: PASS');
