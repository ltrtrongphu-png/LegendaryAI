import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("js/account.js", "utf8");
const resetStart = source.indexOf("if (forgotPasswordBtn) forgotPasswordBtn.addEventListener");
const resetEnd = source.indexOf("if (resetForm) resetForm.addEventListener", resetStart);
assert.ok(resetStart >= 0 && resetEnd > resetStart, "password reset handler must be present");
const reset = source.slice(resetStart, resetEnd);
assert.match(reset, /resetPasswordForEmail\(email/, "password reset must call Supabase Auth");
assert.match(reset, /finally \{[\s\S]*forgotPasswordBtn\.disabled = false/, "password reset must release the button even on exception");
assert.match(reset, /Nếu email có tài khoản đủ điều kiện khôi phục/, "reset result must use account-enumeration-resistant wording");
assert.doesNotMatch(reset, /r\.error\.message|error\.message/, "provider errors must not identify whether an email exists");

const oauthStart = source.indexOf("async function signInOAuth(provider)");
const oauthEnd = source.indexOf("if (googleBtn)", oauthStart);
assert.ok(oauthStart >= 0 && oauthEnd > oauthStart, "OAuth flow must be present");
const oauth = source.slice(oauthStart, oauthEnd);
assert.match(oauth, /catch \(_\)/, "OAuth network errors must be caught");
assert.match(oauth, /sessionStorage\.removeItem\('legendaryai\.pendingConsentVersion'\)/, "failed OAuth must clear pending consent state");
assert.doesNotMatch(oauth, /setError\(loginError, result\.error\.message\)/, "OAuth provider error text must not be exposed directly");
console.log("auth-privacy-contract: assertions passed");
