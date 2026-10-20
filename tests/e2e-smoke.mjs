import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = process.cwd();
const legalRoutes = new Map([
  ["/terms", "/legal/terms.html"],
  ["/privacy", "/legal/privacy.html"],
  ["/refund", "/legal/refund.html"],
  ["/acceptable-use", "/legal/acceptable-use.html"],
  ["/cookies", "/legal/cookies.html"],
  ["/token-policy", "/legal/token-policy.html"],
  ["/contact", "/legal/contact.html"],
  ["/ai-disclosure", "/legal/ai-disclosure.html"],
  ["/payment-result", "/legal/payment-result.html"],
]);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === "/new" || /^\/chat\/[a-zA-Z0-9_-]+$/.test(pathname)) pathname = "/index.html";
    else if (legalRoutes.has(pathname)) pathname = legalRoutes.get(pathname);
    else if (pathname === "/") pathname = "/index.html";
    const file = path.resolve(ROOT, "." + pathname);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404); res.end("Not found"); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(400); res.end("Invalid request");
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert.ok(address && typeof address === "object", "smoke server must bind to a port");
const baseUrl = "http://127.0.0.1:" + address.port;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());

  for (const route of ["/", "/new", "/chat/e2e-smoke"]) {
    const response = await page.goto(baseUrl + route, { waitUntil: "domcontentloaded", timeout: 20000 });
    assert.equal(response?.status(), 200, route + " should serve the app shell");
    assert.match(await page.title(), /Legendary AI/i, route + " should render the app title");
    assert.equal(await page.locator("html").getAttribute("lang"), "vi", route + " should preserve Vietnamese language metadata");
    assert.ok(await page.locator("#chatForm").count(), route + " should contain the chat form");
  }

  for (const [route, file] of legalRoutes) {
    const response = await page.goto(baseUrl + route, { waitUntil: "domcontentloaded", timeout: 20000 });
    assert.equal(response?.status(), 200, route + " should resolve to a legal HTML page");
    assert.match(await page.locator("html").getAttribute("lang") || "", /^vi$/i, route + " should use Vietnamese");
    assert.ok((await page.locator("h1").innerText()).trim().length > 0, route + " should have a primary heading");
    assert.ok(file.endsWith(".html"));
  }

  console.log("playwright-smoke: app shell, deep links and all legal routes passed");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
