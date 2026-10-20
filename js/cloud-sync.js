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
  var syncingUsers = Object.create(null);
  var queuedSyncUsers = Object.create(null);
  var loadSequence = 0;
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
      return JSON.stringify((list || []).filter(function (c) { return !c.draft && !c.syncConflictBackup; }).map(function (c) {
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
    var list = localConversations(user.id).filter(function (conv) { return !conv.draft && !conv.syncConflictBackup; });
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
        // Keep the previous baseline after a conflict so loadCloud knows it
        // must preserve both versions instead of treating local as synced.
        fingerprint: conflict ? (state.fingerprint || '') : fingerprint(list),
        snapshots: nextSnapshots,
        conflict: conflict || false,
        syncedAt: Date.now()
      });
    }
    return { changed: changed, conflict: conflict };
  }


  function preserveConflictCopies(userId, localList, remoteList) {
    var local = (localList || []).filter(function (conv) { return !conv.draft && !conv.syncConflictBackup; });
    var backups = (localList || []).filter(function (conv) { return !!conv.syncConflictBackup; });
    var localById = Object.create(null);
    var remoteById = Object.create(null);
    var backupSources = Object.create(null);
    var snapshots = {};
    var conflicts = [];

    local.forEach(function (conv) { localById[String(conv.id)] = conv; });
    (remoteList || []).forEach(function (conv) { remoteById[String(conv.id)] = conv; });
    backups.forEach(function (conv) { backupSources[String(conv.syncConflictSourceId)] = true; });

    local.forEach(function (conv) {
      var cloud = remoteById[String(conv.id)];
      if (!cloud || fingerprint([conv]) === fingerprint([cloud])) return;
      conflicts.push(String(conv.id));
      // Keep this device's version as the working copy, but make the next
      // deliberate edit newer than the competing cloud revision.
      conv.updatedAt = Math.max(Date.now(), Number(cloud.updatedAt || 0) + 1);
      if (backupSources[String(conv.id)]) return;

      backups.push({
        id: 'conflict-cloud-' + String(cloud.id) + '-' + Date.now() + '-' + conflicts.length,
        title: ('[Bản đám mây] ' + String(cloud.title || 'Cuộc trò chuyện mới')).slice(0, 180),
        slug: String(cloud.slug || 'cuoc-tro-chuyen') + '-cloud-copy-' + Date.now(),
        createdAt: Number(cloud.createdAt || Date.now()),
        updatedAt: Number(cloud.updatedAt || Date.now()),
        draft: false,
        syncConflictBackup: true,
        syncConflictSourceId: String(cloud.id),
        messages: (cloud.messages || []).map(function (msg) {
          return Object.assign({}, msg, {
            attachments: (msg.attachments || []).map(function (att) { return Object.assign({}, att); })
          });
        })
      });
    });

    var localIds = Object.create(null);
    local.forEach(function (conv) {
      localIds[String(conv.id)] = true;
      // Existing cloud IDs can be marked as compared. Local-only conversations
      // deliberately stay unsnapshotted so the next sync retries their upload.
      if (remoteById[String(conv.id)]) snapshots[conv.id] = fingerprint([conv]);
    });
    var cloudOnly = (remoteList || []).filter(function (conv) { return !localIds[String(conv.id)]; });
    cloudOnly.forEach(function (conv) { snapshots[conv.id] = fingerprint([conv]); });
    var kept = local.concat(cloudOnly, backups);
    var primary = kept.filter(function (conv) { return !conv.syncConflictBackup && !conv.draft; });
    mirrorToChatCache(userId, kept);
    writeJson(syncKey(userId), {
      fingerprint: fingerprint(primary),
      snapshots: snapshots,
      conflict: false,
      conflictIds: conflicts,
      syncedAt: Date.now()
    });
    window.dispatchEvent(new CustomEvent('legendary:sync-conflict', {
      detail: { userId: userId, count: conflicts.length }
    }));
    // A fresh local-only conversation may not be part of the conflict itself.
    // Queue a sync pass so it is not lost when the conflict state is cleared.
    setTimeout(syncNow, 0);
    return kept;
  }

  function preserveExistingConflictCopies(localList, remoteList) {
    var backups = (localList || []).filter(function (conv) { return !!conv.syncConflictBackup; });
    var sourceIds = Object.create(null);
    var localById = Object.create(null);
    var remoteIds = Object.create(null);
    (localList || []).filter(function (conv) { return !conv.draft && !conv.syncConflictBackup; })
      .forEach(function (conv) { localById[String(conv.id)] = conv; });
    backups.forEach(function (conv) { sourceIds[String(conv.syncConflictSourceId)] = true; });
    var effectiveRemote = (remoteList || []).map(function (cloud) {
      remoteIds[String(cloud.id)] = true;
      var local = localById[String(cloud.id)];
      return sourceIds[String(cloud.id)] && local ? local : cloud;
    });
    // Do not drop local-only/offline conversations merely because the account's
    // current cloud response did not include them.
    var localOnly = (localList || []).filter(function (conv) {
      return !conv.draft && !conv.syncConflictBackup && !remoteIds[String(conv.id)];
    });
    return effectiveRemote.concat(localOnly, backups);
  }

  async function loadCloud() {
    var sequence = ++loadSequence;
    var user;
    try { user = await getUser(); } catch (_) { return; }
    if (sequence !== loadSequence) return;
    var userId = user ? user.id : 'guest';
    ensureIsolatedCache(userId);

    if (!user) {
      var guest = localConversations('guest');
      if (sequence !== loadSequence) return;
      mirrorToChatCache('guest', guest);
      window.dispatchEvent(new CustomEvent('legendary:cloud-synced'));
      return;
    }

    var local = localConversations(user.id);
    var syncState = readJson(syncKey(user.id), { fingerprint: '', snapshots: {} });
    var snapshotsBeforeLoad = syncState.snapshots || {};
    var hasUnsyncedLocal = local.some(function (conv) {
      return !conv.draft && !conv.syncConflictBackup &&
        snapshotsBeforeLoad[String(conv.id)] !== fingerprint([conv]);
    });
    var localDirty = !!syncState.conflict || hasUnsyncedLocal ||
      (!!syncState.fingerprint && syncState.fingerprint !== fingerprint(local));

    var c = await sb.from('conversations').select('*').eq('user_id', user.id).order('updated_at', { ascending: false });
    if (sequence !== loadSequence) return;
    if (c.error) return;

    var ids = (c.data || []).map(function (x) { return x.id; });
    if (!ids.length) {
      if (local.length) await uploadLocal(user).catch(function () {});
      if (sequence !== loadSequence) return;
      window.dispatchEvent(new CustomEvent('legendary:cloud-synced'));
      return;
    }

    var m = await sb.from('messages').select('*').in('conversation_id', ids).order('created_at', { ascending: true });
    if (sequence !== loadSequence) return;
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

    if (syncState.conflict) {
      preserveConflictCopies(user.id, local, remote);
      return;
    }

    if (localDirty) {
      var pushed = await uploadLocal(user).catch(function () { return { conflict: true }; });
      if (sequence !== loadSequence) return;
      if (pushed.conflict) {
        preserveConflictCopies(user.id, local, remote);
        return;
      }
      window.dispatchEvent(new CustomEvent('legendary:cloud-synced'));
      return;
    }

    if (sequence !== loadSequence) return;
    var preservedRemote = preserveExistingConflictCopies(local, remote);
    mirrorToChatCache(user.id, preservedRemote);
    var snapshots = {};
    remote.forEach(function (conv) { snapshots[conv.id] = fingerprint([conv]); });
    // Keep offline-only revisions in the local aggregate baseline, but leave
    // them unsnapshotted so loadCloud will retry them on a later pass.
    var primaryConversations = preservedRemote.filter(function (conv) {
      return !conv.syncConflictBackup && !conv.draft;
    });
    writeJson(syncKey(user.id), {
      fingerprint: fingerprint(primaryConversations),
      snapshots: snapshots,
      conflict: false,
      syncedAt: Date.now()
    });
    window.dispatchEvent(new CustomEvent('legendary:cloud-synced'));
  }

  async function deleteCloudConversation(id) {
    // Invalidates an in-flight cloud read so it can't resurrect a deleted thread.
    loadSequence += 1;
    var user = await getUser();
    if (!user || !id) return;
    var result = await sb.from('conversations').delete().eq('id', String(id)).eq('user_id', user.id);
    if (result.error) throw result.error;
    var list = localConversations(user.id).filter(function (conv) { return String(conv.id) !== String(id); });
    mirrorToChatCache(user.id, list);
    writeJson(syncKey(user.id), { fingerprint: fingerprint(list), snapshots: {}, syncedAt: Date.now() });
  }

  async function syncNow() {
    var user;
    try { user = await getUser(); } catch (_) { return; }
    if (!user) return;
    var userKey = String(user.id);
    if (syncingUsers[userKey]) {
      queuedSyncUsers[userKey] = true;
      return;
    }
    syncingUsers[userKey] = true;
    try {
      var result = await uploadLocal(user);
      if (result && result.conflict) await loadCloud();
    } catch (_) {
    } finally {
      delete syncingUsers[userKey];
      if (queuedSyncUsers[userKey]) {
        delete queuedSyncUsers[userKey];
        setTimeout(syncNow, 0);
      }
    }
  }

  window.addEventListener('legendary:conversation-deleted', function (event) {
    var id = event && event.detail && event.detail.id;
    deleteCloudConversation(id).catch(function () {});
  });

  window.addEventListener('legendary:auth-changed', function () {
    // Invalidate requests immediately; the auth lookup below is intentionally delayed.
    loadSequence += 1;
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
