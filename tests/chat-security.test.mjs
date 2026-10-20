import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import chatSafety from "../js/chat-safety.js";
const { escapeHtml, safeImageSource } = chatSafety;

assert.equal(
  escapeHtml(`" onmouseover='alert(1)' <img src=x>&`),
  "&quot; onmouseover=&#39;alert(1)&#39; &lt;img src=x&gt;&amp;",
  "HTML text and attribute escaping must include both quote types",
);
assert.equal(safeImageSource("javascript:alert(1)"), "", "javascript URLs must never be used as image sources");
assert.equal(safeImageSource("data:text/html;base64,PHNjcmlwdD4="), "", "non-image data URLs must be rejected");
assert.equal(safeImageSource("data:image/svg+xml;base64,PHN2Zy8+"), "", "SVG data URLs must be rejected");
assert.equal(safeImageSource("data:image/png;base64,QUJDRA=="), "data:image/png;base64,QUJDRA==", "raster image data URLs should remain supported");
assert.equal(safeImageSource("https://example.com/image.png"), "https://example.com/image.png", "legacy HTTPS image URLs should remain supported");
assert.equal(safeImageSource("https://user:pass@example.com/image.png"), "", "URLs with embedded credentials must be rejected");

const chat = readFileSync("js/chat.js", "utf8");
assert.match(chat, /ChatSafety\.escapeHtml\(str\)/, "Markdown renderer must use the shared HTML escaper");
assert.match(chat, /ChatSafety\.safeImageSource\(a\.dataUrl\)/, "attachment rendering must validate image sources");
assert.match(chat, /MAX_RAW_ATTACHMENT_BYTES/, "raw file size must be limited before reading");
assert.match(chat, /MAX_ZIP_ATTACHMENT_BYTES/, "ZIP archives must have a compressed-size cap");
assert.match(chat, /uncompressedSize/, "ZIP entries must be checked before decompression");
assert.match(chat, /MAX_PENDING_ATTACHMENTS/, "number of pending attachments must be limited");
assert.match(chat, /MAX_PENDING_ATTACHMENT_CHARS/, "aggregate attachment content must be bounded");
assert.match(chat, /try \\{\\s*fitChatPayload\\(requestOptions\\);\\s*\\} catch \\(error\\) \\{[\\s\\S]{0,400}?setErrorBubble\\(typing/, "oversized chat payloads must be handled without an unhandled exception");
assert.match(chat, /function abortActiveResponse\(\)/, "chat requests must have a shared cancellation path");
assert.match(chat, /if \(controller\.signal\.aborted\) return/, "aborted responses must not update the selected conversation");
assert.match(chat, /if \(activeController !== controller\) return/, "stale requests must not unlock a newer request");
assert.match(chat, /window\.addEventListener\('popstate', function \(\) \{\s*abortActiveResponse\(\)/, "deep-link navigation must abort the active request");

const account = readFileSync("js/account.js", "utf8");
assert.match(account, /\.replace\(\/\\\"\/g, '&quot;'\)/, "account templates must escape double quotes in dynamic attributes");
assert.match(account, /\.replace\(\/'\/g, '&#39;'\)/, "account templates must escape single quotes");
const html = readFileSync("index.html", "utf8");
assert.ok(html.indexOf('/js/chat-safety.js') < html.indexOf('/js/chat.js'), "chat safety helpers must load before the chat renderer");
console.log("chat-security: assertions passed");
