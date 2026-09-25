(function () {
  'use strict';
  if (!window.LegendaryBackend || !window.LegendaryBackend.enabled) return;
  var sb = window.LegendaryBackend.client;
  var CONV_KEY = 'legendaryai_conversations_v2';
  var ACTIVE_KEY = 'legendaryai_active_conv_v2';
  var syncing = false;

  function localConversations() {
    try { return JSON.parse(localStorage.getItem(CONV_KEY) || '[]'); } catch (e) { return []; }
  }
  function cleanAttachments(list) {
    return (list || []).map(function (a) {
      return {
        name: a.name || '',
        kind: a.kind || 'text',
        mediaType: a.mediaType || '',
        textContent: a.kind === 'text' ? (a.textContent || '') : ''
      };
    });
  }

  async function getUser() {
    return window.LegendaryBackend.getUser();
  }

  async function loadCloud() {
    var user = await getUser();
    if (!user) return;
    var c = await sb.from('conversations').select('*').eq('user_id', user.id).order('updated_at', { ascending: false });
    if (c.error) return;

    var ids = (c.data || []).map(function (x) { return x.id; });
    if (!ids.length) {
      await uploadLocal(user);
      return;
    }

    var m = await sb.from('messages').select('*').in('conversation_id', ids).order('created_at', { ascending: true });
    if (m.error) return;

    var byId = {};
    (m.data || []).forEach(function (row) {
      (byId[row.conversation_id] || (byId[row.conversation_id] = [])).push({
        role: row.role === 'assistant' ? 'ai' : row.role,
        text: row.content,
        attachments: row.attachments || []
      });
    });

    var remote = (c.data || []).map(function (row) {
      return {
        id: row.id,
        title: row.title,
        createdAt: new Date(row.created_at).getTime(),
        messages: byId[row.id] || []
      };
    });

    var local = localConversations();
    if (local.length && local.some(function (x) { return String(x.id).indexOf('c') === 0; })) {
      await uploadLocal(user);
    }
    localStorage.setItem(CONV_KEY, JSON.stringify(remote));
    if (!localStorage.getItem(ACTIVE_KEY) || !remote.some(function (x) { return x.id === localStorage.getItem(ACTIVE_KEY); })) {
      localStorage.setItem(ACTIVE_KEY, remote[0].id);
    }
    location.reload();
  }

  async function uploadLocal(user) {
    var list = localConversations();
    if (!list.length) return;

    for (var i = 0; i < list.length; i++) {
      var conv = list[i];
      await sb.from('conversations').upsert({
        id: String(conv.id),
        user_id: user.id,
        title: conv.title || 'Cuộc trò chuyện mới',
        created_at: new Date(conv.createdAt || Date.now()).toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      for (var j = 0; j < (conv.messages || []).length; j++) {
        var msg = conv.messages[j];
        await sb.from('messages').upsert({
          id: String(conv.id) + ':' + j,
          conversation_id: String(conv.id),
          user_id: user.id,
          role: msg.role === 'ai' ? 'assistant' : msg.role,
          content: msg.text || '',
          attachments: cleanAttachments(msg.attachments),
          created_at: new Date((conv.createdAt || Date.now()) + j).toISOString()
        }, { onConflict: 'id' });
      }
    }
  }

  async function syncNow() {
    if (syncing) return;
    var user = await getUser();
    if (!user) return;
    syncing = true;
    try { await uploadLocal(user); } finally { syncing = false; }
  }

  window.addEventListener('legendary:auth-changed', function () {
    setTimeout(loadCloud, 400);
  });

  setTimeout(loadCloud, 900);
  setInterval(syncNow, 3000);
})();