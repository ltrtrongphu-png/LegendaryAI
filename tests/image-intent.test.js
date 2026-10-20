function isImageGenerationPrompt(text) {
  var x = String(text || '').trim().toLowerCase();
  if (!x) return false;

  if (/(?:^|\s)(?:vẽ|draw)(?:\s|$)/i.test(x)) {
    return !/(?:sơ đồ|diagram|mermaid|flowchart|biểu đồ|chart|graph|code|mã|architecture|kiến trúc)/i.test(x);
  }

  return /(?:^|\s)(?:tạo|generate|create)(?:\s|$)/i.test(x) &&
    /(?:^|\s)(?:ảnh|hình|image|picture|illustration|art|wallpaper|avatar|logo|poster|thumbnail|photo|meme)(?:\s|$)/i.test(x);
}

var cases = [
  ['create a smart contract in Solidity', false],
  ['generate a report about particles', false],
  ['tạo kế hoạch hình thành thói quen', false],
  ['viết code vẽ biểu đồ bằng matplotlib', false],
  ['vẽ sơ đồ kiến trúc bằng mermaid', false],
  ['vẽ một bức tranh phong cảnh', true],
  ['tạo ảnh con mèo', true],
  ['generate a logo for LegendaryAI', true],
  ['draw a fantasy landscape', true]
];

cases.forEach(function (item) {
  var actual = isImageGenerationPrompt(item[0]);
  if (actual !== item[1]) throw new Error('Intent mismatch: ' + item[0] + ' => ' + actual + ', expected ' + item[1]);
});

console.log('image-intent: ' + cases.length + ' cases passed');
