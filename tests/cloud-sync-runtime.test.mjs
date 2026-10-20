import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync("js/chat.js", "utf8");
const cloud = readFileSync("js/cloud-sync.js", "utf8");

assert.match(chat, /function touchConversation\(conv\)/, "chat must have a central conversation version update");
for (const [marker, description] of [
  ["touchConversation(conv);\n\n    persistConversations();", "ordinary message mutation must advance updatedAt"],
  ["conv.messages.splice(idx, 1);\n    conv._regenerateNonce = messageUid();\n    touchConversation(conv);", "regeneration/deletion must advance updatedAt"],
  ["conv.messages = [\n          {", "clear-conversation path must exist"],
  ["window.addEventListener('legendary:sync-conflict'", "chat must notify the user when a conflict is preserved"],
]) assert.ok(chat.includes(marker), description);

assert.match(cloud, /var loadSequence = 0/, "cloud reads need a monotonic request generation");
assert.match(cloud, /sequence !== loadSequence/, "stale async cloud reads must not write cache");
assert.match(cloud, /loadSequence \+= 1;[\s\S]{0,100}clearTimeout\(syncTimer\)/, "auth changes must invalidate old-user reads immediately");
assert.match(cloud, /var syncingUsers = Object\.create\(null\)/, "sync lock must be scoped by user");
assert.match(cloud, /queuedSyncUsers\[userKey\] = true/, "changes during a sync must queue another pass");
assert.match(cloud, /syncConflictBackup/, "cloud conflict backups must be excluded from upload/fingerprint to avoid loops");
assert.match(cloud, /function preserveConflictCopies\(/, "local and cloud versions must both be preserved on conflict");
assert.match(cloud, /\[Bản đám mây\]/, "cloud conflict copy must be clearly labeled");
assert.match(cloud, /function preserveExistingConflictCopies\(/, "conflict copies must survive later reloads");
assert.match(cloud, /hasUnsyncedLocal/, "local-only conversations without a sync snapshot must be retried");
assert.match(cloud, /var localOnly = \(localList \|\| \[\]\)\.filter/, "later cloud loads must keep local-only conversations");
assert.match(cloud, /setTimeout\(loadCloud, 0\)/, "successful local upload must reload remote-only conversations");

const migration = readFileSync("supabase/migrations/20261003153000_conversation_sync_rpc.sql", "utf8");
assert.match(migration, /p_updated_at >= current_updated/, "client must honor the RPC's monotonic updated_at comparison");
console.log("cloud-sync-runtime: assertions passed");
