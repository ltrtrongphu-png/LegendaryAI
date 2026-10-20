(function () {
  'use strict';
  if (!window.LegendaryBackend || !window.LegendaryBackend.enabled) return;

  var sb = window.LegendaryBackend.client;
  var LEGACY_KEY = 'legendaryai_conversations_v2';
  var ACTIVE_KEY = 'legendaryai_active_conv_v2';
  var OWNER_KEY = 'legendaryai_conv_owner_v3';
  var CACHE_PREFIX = 'legendaryai_conversations_v3:';
  var ACTIVE_PREFIX = 'legendaryai_active_conv_v3:';
  var SYNC_PREFIX = 'legendaryai_sync_state_v3:';
  var syncing = false;
  var syncTimer = null;

  function cacheKey(userId) { return CACHE_PREFIX + (userId || 'guest'); }
  function activeKey(userId) { return ACTIVE_PREFIX + (userId || 'guest'); }
  function syncKey(userId) { return SYNC_PREFIX + (userId || 'guest'); }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function removeUserCache(userId) {
    if (!userId || userId === 'guest') return;
    try {
      localStorage.removeItem(cacheKey(userId));
      localStorage.removeItem(activeKey(userId));
      localStorage.removeItem(syncKey(userId));
    } catch (_) {}
  }

  function localConversations(userId) {
    var list = readJson(cacheKey(userId), null);
    return Array.isArray(list) ? list : [];
  }

  function mirrorToChatCache(userId, list) {
    writeJson(cacheKey(userId), list);
    writeJson(LEGACY_KEY, list);
    var active = readJson(activeKey(userId), null);
    if (!active || !list.some(function (x) { return x.id === active; })) active = list[0] && list[0].id;
    if (active) {
      try {
        localStorage.setItem(activeKey(userId), active);
        localStorage.setItem(ACTIVE_KEY, active);
      } catch (_) {}
    }
    try { localStorage.setItem(OWNER_KEY, userId || 'guest'); } catch (_) {}
  }

  function clearSharedCache() {
    try {
      localStorage.removeItem(LEGACY_KEY);
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(OWNER_KEY);
    } catch (_) {}
  }

  function ensureIsolatedCache(userId) {
    var owner = null;
    try { owner = localStorage.getItem(OWNER_KEY); } catch (_) {}
    if (owner !== (userId || 'guest')) clearSharedCache();
  }

  function fingerprint(list) {
    try {
      return JSON.stringify((list || []).filter(function (c) { return !c.draft; }).map(function (c) {
        return {
          id: c.id,
          title: c.title,
          slug: c.slug,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt || 0,
          messages: c.messages || []
        };
      }));
    } catch (_) { return ''; }
  }

  function cleanAttachments(list) {
    return (list || []).map(function (a) {
      return {
        name: a.name || '',
        kind: a.kind || 'text',
        mediaType: a.mediaType || '',
        dataUrl: '',
        textContent: a.kind === 'text' || a.kind === 'archive' ? String(a.textContent || '').slice(0, 30000) : ''
      };
    });
  }

  async function getUser() { return window.LegendaryBackend.getUser(); }

  function messageId(convId, msg, index) {
    var existing = msg && msg.id;
    if (existing) return String(existing);
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return String(convId) + ':legacy:' + index;
  }

  function prepareConversation(conv) {
    var now = Date.now();
    var copy = Object.assign({}, conv);
    copy.updatedAt = Number(conv.updatedAt || now);
    copy.messages = (conv.messages || []).map(function (msg, index) {
      return Object.assign({}, msg, {
        id: messageId(conv.id, msg, index),
        attachments: cleanAttachments(msg.attachments)
      });
    });
    return copy;
  }

  async function syncConversation(user, conv) {
    var prepared = prepareConversation(conv);
    var payload = (prepared.messages || []).map(function (msg, index) {
      return {
        id: messageId(prepared.id, msg, index),
        conversation_id: String(prepared.id),
        user_id: user.id,
        role: msg.role === 'ai' ? 'assistant' : msg.role,
        content: String(msg.text || '').slice(0, 120000),
        attachments: cleanAttachments(msg.attachments),
        created_at: new Date((prepared.createdAt || Date.now()) + index).toISOString()
      };
    });

    var result = await sb.rpc('sync_conversation', {
      p_id: String(prepared.id),
      p_user_id: user.id,
      p_title: String(prepared.title || 'Cuộc trò chuyện mới').slice(0, 200),
      p_slug: prepared.slug || null,
      p_created_at: new Date(prepared.createdAt || Date.now()).toISOString(),
      p_updated_at: new Date(prepared.updatedAt).toISOString(),
      p_messages: payload
    });
    if (result.error) throw result.error;
    return result.data || { accepted: true };
  }

  async function uploadLocal(user) {
    var list = localConversations(user.id).filter(function (conv) { return !conv.draft; });
    if (!list.length) return { changed: false, conflict: false };

    var state = readJson(syncKey(user.id), { fingerprint: '', snapshots: {} });
    var changed = false;
    var conflict = false;
    var nextSnapshots = Object.assign({}, state.snapshots || {});

    for (var i = 0; i < list.length; i++) {
      var conv = list[i];
      var fp = fingerprint([conv]);
      if (nextSnapshots[conv.id] === fp) continue;
      var result = await syncConversation(user, conv);
      if (result && result.accepted === false) { conflict = true; continue; }
      nextSnapshots[conv.id] = fp;
      changed = true;
    }

    if (changed || conflict) {
      writeJson(syncKey(user.id), {
        fingerprint: fingerprint(list),
        snapshots: nextSnapshots,
        syncedAt: Date.now()
      });
    }
    return { changed: changed, conflict: conflict };
  }

  async function loadCloud() {
    var user = await getUser();
    var userId = user ? user.id : 'guest';
    ensureIsolatedCache(userId);

    if (!user) {
      var guest = localConversations('guest');
      mirrorToChatCache('guest', guest);
      window.dispatchEvent(new CustomEvent('legendary:cloud-synced'));
      return;
    }

    var local = localConversations(user.id);
    var syncState = readJson(syncKey(user.id), { fingerprint: '', snapshots: {} });
    var localDirty = syncState.fingerprint && syncState.fingerprint !== fingerprint(local);

    var c = await sb.from('conversations').select('*').eq('user_id', user.id).order('updated_at', { ascending: false });
    if (c.error) return;

    var ids = (c.data || []).map(function (x) { return x.id; });
    if (!ids.length) {
      if (local.length) await uploadLocal(user).catch(function () {});
      return;
    }

    var m = await sb.from('messages').select('*').in('conversation_id', ids).order('created_at', { ascending: true });
    if (m.error) return;

    var byId = {};
    (m.data || []).forEach(function (row) {
      (byId[row.conversation_id] || (byId[row.conversation_id] = [])).push({
        id: row.id,
        role: row.role === 'assistant' ? 'ai' : row.role,
        text: row.content,
        attachments: row.attachments || []
      });
    });

    var remote = (c.data || []).map(function (row) {
      return {
        id: row.id,
        title: row.title,
        slug: row.slug || '',
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
        draft: false,
        messages: byId[row.id] || []
      };
    });

    if (localDirty) {
      var pushed = await uploadLocal(user).catch(function () { return { conflict: true }; });
      if (!pushed.conflict) {
        window.dispatchEvent(new CustomEvent('legendary:cloud-synced'));
        return;
      }
    }

    mirrorToChatCache(user.id, remote);
    writeJson(syncKey(user.id), { fingerprint: fingerprint(remote), snapshots: {}, syncedAt: Date.now() });
    window.dispatchEvent(new CustomEvent('legendary:cloud-synced'));
  }

  async function deleteCloudConversation(id) {
    var user = await getUser();
    if (!user || !id) return;
    var result = await sb.from('conversations').delete().eq('id', String(id)).eq('user_id', user.id);
    if (result.error) throw result.error;
    var list = localConversations(user.id).filter(function (conv) { return String(conv.id) !== String(id); });
    mirrorToChatCache(user.id, list);
    writeJson(syncKey(user.id), { fingerprint: fingerprint(list), snapshots: {}, syncedAt: Date.now() });
  }

  async function syncNow() {
    if (syncing) return;
    var user = await getUser();
    if (!user) return;
    syncing = true;
    try {
      var result = await uploadLocal(user);
      if (result && result.conflict) await loadCloud();
    } catch (_) {
    } finally {
      syncing = false;
    }
  }

  window.addEventListener('legendary:conversation-deleted', function (event) {
    var id = event && event.detail && event.detail.id;
    deleteCloudConversation(id).catch(function () {});
  });

  window.addEventListener('legendary:auth-changed', function () {
    clearTimeout(syncTimer);
    var previousOwner = null;
    try { previousOwner = localStorage.getItem(OWNER_KEY); } catch (_) {}
    setTimeout(async function () {
      var currentUser = null;
      try { currentUser = await window.LegendaryBackend.getUser(); } catch (_) { currentUser = null; }
      var currentId = currentUser && currentUser.id;
      if (!currentId && previousOwner && previousOwner !== 'guest') {
        removeUserCache(previousOwner);
        clearSharedCache();
      } else if (currentId && previousOwner && previousOwner !== currentId) {
        removeUserCache(previousOwner);
        clearSharedCache();
      }
      await loadCloud();
    }, 100);
  });

  window.addEventListener('legendary:conversation-changed', function () {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 600);
  });

  setTimeout(loadCloud, 900);
})();
