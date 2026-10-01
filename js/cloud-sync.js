(function () {
  'use strict';
  if (!window.LegendaryBackend || !window.LegendaryBackend.enabled) return;

  var sb = window.LegendaryBackend.client;
  var CONV_KEY = 'legendaryai_conversations_v2';
  var ACTIVE_KEY = 'legendaryai_active_conv_v2';
  var syncing = false;
  var syncTimer = null;

  function localConversations() {
    try { return JSON.parse(localStorage.getItem(CONV_KEY) || '[]'); } catch (_) { return []; }
  }

  function cleanAttachments(list) {
    return (list || []).map(function (a) {
      return {
        name: a.name || '',
        kind: a.kind || 'text',
        mediaType: a.mediaType || '',
        dataUrl: (a.dataUrl && String(a.dataUrl).length <= 180000) ? String(a.dataUrl) : '',
        textContent: a.kind === 'text' || a.kind === 'archive' ? String(a.textContent || '').slice(0, 30000) : ''
      };
    });
  }

  async function getUser() {
    return window.LegendaryBackend.getUser();
  }

  function messageId(convId, msg, index) {
    return String(msg && msg.id || (String(convId) + ':legacy:' + index));
  }

  async function uploadLocal(user) {
    var list = localConversations().filter(function (conv) { return !conv.draft; });
    if (!list.length) return;

    var convRows = list.map(function (conv) {
      return {
        id: String(conv.id),
        user_id: user.id,
        title: String(conv.title || 'Cuộc trò chuyện mới').slice(0, 200),
        slug: conv.slug || null,
        created_at: new Date(conv.createdAt || Date.now()).toISOString(),
        updated_at: new Date().toISOString()
      };
    });

    var cr = await sb.from('conversations').upsert(convRows, { onConflict: 'id' });
    if (cr.error) throw cr.error;

    // Replace each conversation's message set in one delete + one bulk upsert.
    // This removes stale rows after regenerate/edit while avoiding one HTTP request per message.
    for (var i = 0; i < list.length; i++) {
      var conv = list[i];
      var del = await sb.from('messages').delete().eq('conversation_id', String(conv.id));
      if (del.error) throw del.error;

      var messages = (conv.messages || []).map(function (msg, index) {
        return {
          id: messageId(conv.id, msg, index),
          conversation_id: String(conv.id),
          user_id: user.id,
          role: msg.role === 'ai' ? 'assistant' : msg.role,
          content: String(msg.text || '').slice(0, 120000),
          attachments: cleanAttachments(msg.attachments),
          created_at: new Date((conv.createdAt || Date.now()) + index).toISOString()
        };
      });

      if (messages.length) {
        var mr = await sb.from('messages').insert(messages);
        if (mr.error) throw mr.error;
      }
    }
  }

  async function loadCloud() {
    var user = await getUser();
    if (!user) return;

    var c = await sb.from('conversations')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (c.error) return;

    var ids = (c.data || []).map(function (x) { return x.id; });
    if (!ids.length) {
      await uploadLocal(user).catch(function () {});
      return;
    }

    var m = await sb.from('messages')
      .select('*')
      .in('conversation_id', ids)
      .order('created_at', { ascending: true });
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
        draft: false,
        messages: byId[row.id] || []
      };
    });

    localStorage.setItem(CONV_KEY, JSON.stringify(remote));
    if (!localStorage.getItem(ACTIVE_KEY) || !remote.some(function (x) { return x.id === localStorage.getItem(ACTIVE_KEY); })) {
      localStorage.setItem(ACTIVE_KEY, remote[0].id);
    }
    window.dispatchEvent(new CustomEvent('legendary:cloud-synced'));
  }

  async function deleteCloudConversation(id) {
    var user = await getUser();
    if (!user || !id) return;
    var result = await sb.from('conversations').delete().eq('id', String(id)).eq('user_id', user.id);
    if (result.error) throw result.error;
  }

  async function syncNow() {
    if (syncing) return;
    var user = await getUser();
    if (!user) return;
    syncing = true;
    try {
      await uploadLocal(user);
    } catch (_) {
      // A transient cloud failure must never break local chat.
    } finally {
      syncing = false;
    }
  }

  window.addEventListener('legendary:conversation-deleted', function (event) {
    var id = event && event.detail && event.detail.id;
    deleteCloudConversation(id).catch(function () {});
  });

  window.addEventListener('legendary:auth-changed', function () {
    setTimeout(loadCloud, 400);
  });

  window.addEventListener('legendary:conversation-changed', function () {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 500);
  });

  setTimeout(loadCloud, 900);
  setInterval(syncNow, 15000);
})();