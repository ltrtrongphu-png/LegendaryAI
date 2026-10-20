import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync("js/chat.js", "utf8");
const account = readFileSync("js/account.js", "utf8");

assert.match(chat, /window\.addEventListener\('legendary:cloud-synced', rehydrateConversationsFromCloud\)/, "the chat UI must hydrate the authoritative cache after cloud sync");
assert.match(chat, /function rehydrateConversationsFromCloud\(\)/, "cloud rehydration must be centralized");
assert.match(chat, /var incoming = loadConversations\(\)\.filter\(function \(conv\) \{ return !conv\.draft; \}\)/, "cloud history reload must avoid duplicate placeholder drafts");
const authStart = chat.lastIndexOf("window.addEventListener('legendary:auth-changed', function ()");
const authEnd = chat.indexOf("window.addEventListener('legendary:sync-conflict'", authStart);
assert.ok(authStart >= 0 && authEnd > authStart, "chat auth change handler must be present");
const auth = chat.slice(authStart, authEnd);
assert.match(auth, /abortActiveResponse\(\)/, "auth changes must cancel old-user responses");
assert.match(auth, /pendingAttachments = \[\]/, "auth changes must clear in-memory attachments");
assert.match(auth, /chatInput\.value = ''/, "auth changes must clear the previous user's unsent prompt");
assert.match(auth, /conversations = \[makeNewConversation\(\)\]/, "auth changes must immediately replace previous-user history in memory");

assert.match(account, /function clearAccountScopedCache\(userId\)/, "account controls must centralize local cache cleanup");
for (const key of ["legendaryai_conversations_v3:", "legendaryai_active_conv_v3:", "legendaryai_sync_state_v3:"]) {
  assert.ok(account.includes("localStorage.removeItem('" + key + "' + userId)"), "sign-out/delete must remove " + key + " for that user");
}
assert.match(account, /await signOut\(\);[\s\S]{0,160}clearAccountScopedCache\(deletedUser\.id\)/, "account deletion must clear the deleted user's local cache even if auth lookup fails afterward");
assert.match(account, /event === 'SIGNED_IN' \|\| event === 'SIGNED_OUT'/, "OAuth redirects and direct auth changes must notify chat/cloud sync");
console.log("chat-auth-cache-contract: assertions passed");
