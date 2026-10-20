import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("js/cloud-sync.js", "utf8");
const userId = "sync-test-user";
const store = new Map();
const listeners = new Map();
const timers = [];
let nextTimer = 1;

const localConversations = [
  {
    id: "conv-conflict",
    title: "Local working copy",
    slug: "local-working-copy",
    createdAt: 1000,
    updatedAt: 2000,
    messages: [{ id: "local-message", role: "user", text: "local version", attachments: [] }],
  },
  {
    id: "conv-offline-only",
    title: "Offline draft",
    slug: "offline-draft",
    createdAt: 1500,
    updatedAt: 2500,
    messages: [{ id: "offline-message", role: "user", text: "created while offline", attachments: [] }],
  },
];
store.set("legendaryai_conversations_v3:" + userId, JSON.stringify(localConversations));
store.set("legendaryai_conv_owner_v3", userId);
store.set("legendaryai_sync_state_v3:" + userId, JSON.stringify({
  fingerprint: "pre-change-baseline",
  snapshots: { "conv-conflict": "old-local-snapshot" },
}));

const db = {
  conversations: [{
    id: "conv-conflict",
    user_id: userId,
    title: "Cloud working copy",
    slug: "cloud-working-copy",
    created_at: new Date(1000).toISOString(),
    updated_at: new Date(5000).toISOString(),
  }],
  messages: [{
    id: "cloud-message",
    conversation_id: "conv-conflict",
    user_id: userId,
    role: "assistant",
    content: "cloud version",
    attachments: [],
    created_at: new Date(5000).toISOString(),
  }],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeQuery {
  constructor(table) {
    this.table = table;
    this.operation = "select";
    this.filters = [];
    this.orders = [];
  }
  select() { this.operation = "select"; return this; }
  delete() { this.operation = "delete"; return this; }
  eq(field, value) { this.filters.push({ field, kind: "eq", value }); return this; }
  in(field, value) { this.filters.push({ field, kind: "in", value }); return this; }
  order(field, options = {}) { this.orders.push({ field, ascending: options.ascending !== false }); return this; }
  run() {
    let rows = db[this.table];
    const matches = (row) => this.filters.every((filter) => {
      if (filter.kind === "eq") return String(row[filter.field]) === String(filter.value);
      return filter.value.map(String).includes(String(row[filter.field]));
    });
    if (this.operation === "delete") {
      const removed = rows.filter(matches);
      db[this.table] = rows.filter((row) => !matches(row));
      return { data: clone(removed), error: null };
    }
    rows = rows.filter(matches);
    for (const order of this.orders.slice().reverse()) {
      rows.sort((a, b) => {
        const cmp = String(a[order.field] ?? "").localeCompare(String(b[order.field] ?? ""));
        return order.ascending ? cmp : -cmp;
      });
    }
    return { data: clone(rows), error: null };
  }
  then(resolve, reject) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject);
  }
}

const client = {
  from(table) { return new FakeQuery(table); },
  async rpc(name, args) {
    assert.equal(name, "sync_conversation");
    assert.equal(args.p_user_id, userId);
    const current = db.conversations.find((row) =>
      String(row.id) === String(args.p_id) && row.user_id === userId
    );
    const nextTime = new Date(args.p_updated_at).getTime();
    if (current && nextTime < new Date(current.updated_at).getTime()) {
      return { data: { accepted: false }, error: null };
    }
    const row = {
      id: String(args.p_id),
      user_id: userId,
      title: args.p_title,
      slug: args.p_slug,
      created_at: args.p_created_at,
      updated_at: args.p_updated_at,
    };
    if (current) Object.assign(current, row);
    else db.conversations.push(row);
    db.messages = db.messages.filter((message) => String(message.conversation_id) !== String(args.p_id));
    for (const msg of args.p_messages || []) {
      db.messages.push({
        id: String(msg.id),
        conversation_id: String(args.p_id),
        user_id: userId,
        role: msg.role,
        content: msg.content,
        attachments: clone(msg.attachments || []),
        created_at: msg.created_at,
      });
    }
    return { data: { accepted: true }, error: null };
  },
};

const window = {
  LegendaryBackend: {
    enabled: true,
    client,
    async getUser() { return { id: userId }; },
  },
  crypto: { randomUUID: () => "unused-random-id" },
  addEventListener(type, handler) {
    const handlers = listeners.get(type) || [];
    handlers.push(handler);
    listeners.set(type, handlers);
  },
  dispatchEvent(event) {
    for (const handler of listeners.get(event.type) || []) handler(event);
    return true;
  },
};

class FakeCustomEvent {
  constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
}

const localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); },
};

function schedule(fn, delay = 0) {
  const timer = { id: nextTimer++, fn, delay, cancelled: false };
  timers.push(timer);
  return timer.id;
}
function cancelTimer(id) {
  const timer = timers.find((item) => item.id === id);
  if (timer) timer.cancelled = true;
}
async function drainTimers() {
  let turns = 0;
  while (timers.length && turns < 100) {
    const timer = timers.shift();
    turns++;
    if (timer.cancelled) continue;
    await timer.fn();
    await Promise.resolve();
  }
  assert.ok(turns < 100, "timer queue should settle instead of creating a sync loop");
}

vm.runInNewContext(source, {
  window,
  localStorage,
  CustomEvent: FakeCustomEvent,
  setTimeout: schedule,
  clearTimeout: cancelTimer,
  Date,
  JSON,
  Object,
  Array,
  String,
  Number,
  Math,
  Promise,
  console,
});

await drainTimers();

const cacheKey = "legendaryai_conversations_v3:" + userId;
const stateKey = "legendaryai_sync_state_v3:" + userId;
let cache = JSON.parse(localStorage.getItem(cacheKey));
let primary = cache.find((conversation) => conversation.id === "conv-conflict");
let cloudBackup = cache.find((conversation) => conversation.syncConflictBackup && conversation.syncConflictSourceId === "conv-conflict");

assert.ok(primary, "the local conversation remains the primary working copy");
assert.equal(primary.messages[0].text, "local version", "the local message body must not be silently replaced");
assert.ok(cloudBackup, "the previous cloud version must be preserved as a separate local backup");
assert.match(cloudBackup.title, /^\[Bản đám mây\]/, "the cloud backup must be visibly labeled");
assert.equal(cloudBackup.messages[0].text, "cloud version", "the backup must retain the original cloud body");
assert.ok(db.conversations.some((conversation) => conversation.id === "conv-offline-only"), "offline-only conversations should be retried and uploaded instead of disappearing");
assert.equal(JSON.parse(localStorage.getItem(stateKey)).conflict, false, "the conflict should be resolved into preserved local copies");

window.dispatchEvent(new FakeCustomEvent("legendary:auth-changed"));
await drainTimers();
cache = JSON.parse(localStorage.getItem(cacheKey));
primary = cache.find((conversation) => conversation.id === "conv-conflict");
cloudBackup = cache.find((conversation) => conversation.syncConflictBackup && conversation.syncConflictSourceId === "conv-conflict");
assert.equal(primary.messages[0].text, "local version", "a later cloud refresh must not overwrite the preserved working copy");
assert.ok(cloudBackup, "the local cloud-backup must survive later cloud reloads");

primary.updatedAt = Date.now() + 60000;
primary.messages[0].text = "deliberate local edit after conflict review";
localStorage.setItem(cacheKey, JSON.stringify(cache));
window.dispatchEvent(new FakeCustomEvent("legendary:conversation-changed"));
await drainTimers();
const cloudAfterEdit = db.messages.find((message) => message.conversation_id === "conv-conflict");
assert.equal(cloudAfterEdit.content, "deliberate local edit after conflict review", "a subsequent deliberate newer local edit should sync normally");
cache = JSON.parse(localStorage.getItem(cacheKey));
assert.ok(cache.some((conversation) => conversation.syncConflictBackup && conversation.syncConflictSourceId === "conv-conflict"), "editing the primary must not remove the preserved comparison copy");

console.log("cloud-sync-integration: conflict, offline-only and later-edit scenarios passed");
