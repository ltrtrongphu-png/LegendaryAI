import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const vercel = JSON.parse(read("vercel.json"));
const rewrites = new Map((vercel.rewrites || []).map((rule) => [rule.source, rule.destination]));
const pages = ["terms", "privacy", "refund", "acceptable-use", "cookies", "token-policy", "contact", "ai-disclosure", "payment-result"];
for (const slug of pages) {
  assert.ok(existsSync("legal/" + slug + ".html"), "Missing legal page " + slug);
  assert.equal(rewrites.get("/" + slug), "/legal/" + slug + ".html", "Missing Vercel rewrite for /" + slug);
}
for (const slug of pages.filter((x) => x !== "payment-result")) {
  const html = read("legal/" + slug + ".html");
  assert.match(html, /lang="vi"/, slug + " should declare Vietnamese as its primary language");
  assert.match(html, slug === "token-policy" ? /Phiên bản 1\.0\.1/ : /Phiên bản 1\.0\.0/, slug + " needs the expected policy version");
  assert.match(html, /TÊN ĐƠN VỊ|EMAIL HỖ TRỢ|ĐỊA CHỈ LIÊN HỆ/i, slug + " must keep unknown operator facts as placeholders");
}
const main = read("index.html");
assert.match(main, /id="authPolicyConsent"/, "Registration/OAuth consent checkbox should be visible");
assert.match(main, /href="\/terms"/, "footer/consent should link terms");
assert.match(main, /href="\/privacy"/, "footer/consent should link privacy");
assert.match(read("js/account.js"), /legal_consent: \{ terms: true, privacy: true, version: '1\.0\.0' \}/, "email signup must pass consent metadata");
assert.match(read("supabase/migrations/20261020120000_legal_payment_retention_hardening.sql"), /create table if not exists public\.user_consents/i, "consent evidence table must exist");
assert.match(read("legal/contact.js"), /functions\/v1\/support-request/, "contact form must reach a real API");
assert.match(read("legal/payment-result.js"), /functions\/v1\/account-data/, "payment-result must ask the authenticated server for status");
assert.doesNotMatch(read("legal/payment-result.js"), /auth\.signOut\(/, "payment status must not log the user out");
assert.match(read("legal/payment-result.js"), /status === 'paid'/, "payment page must display server confirmed state");
console.log("legal-routes: assertions passed");
