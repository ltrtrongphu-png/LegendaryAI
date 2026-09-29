(function () {
  var chatApp = document.getElementById('chatApp');
  var chatSidebar = document.getElementById('chatSidebar');
  var sidebarToggle = document.getElementById('sidebarToggle');
  var newChatBtn = document.getElementById('newChatBtn');
  var convList = document.getElementById('convList');
  var expandChatBtn = document.getElementById('expandChatBtn');
  var exportChatBtn = document.getElementById('exportChatBtn');

  var chatWindow = document.getElementById('chatWindow');
  var chatForm = document.getElementById('chatForm');
  var chatInput = document.getElementById('chatInput');
  var chatModeLabel = document.getElementById('chatModeLabel');
  var chatDot = document.getElementById('chatDot');
  var sendBtn = document.getElementById('sendBtn');
  var stopBtn = document.getElementById('stopBtn');
  var clearChatBtn = document.getElementById('clearChatBtn');
  var charCount = document.getElementById('chatCharCount');
  var streamStatus = document.getElementById('chatStreamStatus');
  var suggestionsWrap = document.getElementById('chatSuggestions');
  var attachBtn = document.getElementById('attachBtn');
  var fileInput = document.getElementById('fileInput');
  var attachPreview = document.getElementById('attachPreview');

  var settingsBtn = document.getElementById('settingsBtn');
  var settingsBackdrop = document.getElementById('settingsBackdrop');
  var closeSettings = document.getElementById('closeSettings');
  var saveSettings = document.getElementById('saveSettings');
  var modeSelect = document.getElementById('modeSelect');
  var providerSelect = document.getElementById('providerSelect');
  var apiEndpoint = document.getElementById('apiEndpoint');
  var apiKey = document.getElementById('apiKey');
  var apiModel = document.getElementById('apiModel');
  var systemPrompt = document.getElementById('systemPrompt');
  var streamToggle = document.getElementById('streamToggle');
  var engineModelSelect = document.getElementById('engineModelSelect');
  var chatModelSelect = document.getElementById('chatModelSelect');
  var reasoningToggle = document.getElementById('reasoningToggle');
  var promptPresetSelect = document.getElementById('promptPresetSelect');
  var tokenHud = document.getElementById('chatTokenHud');
  var tokensRemainingEl = document.getElementById('chatTokensRemaining');
  var tokenResetEl = document.getElementById('chatTokenReset');

  function formatTokenNumber(value) {
    return Number(value || 0).toLocaleString('vi-VN');
  }

  function formatResetCountdown(iso) {
    if (!iso) return '';
    var ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'đang hồi…';
    var mins = Math.ceil(ms / 60000);
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return '· hồi sau ' + h + 'h ' + String(m).padStart(2, '0') + 'm';
  }

  function updateTokenHud(state) {
    if (!tokensRemainingEl) return;
    if (!state) {
      tokensRemainingEl.textContent = '—';
      if (tokenResetEl) tokenResetEl.textContent = '';
      return;
    }
    var remaining = state.tokens_remaining;
    if (remaining == null && state.token_limit != null) {
      remaining = Math.max(Number(state.token_limit) - Number(state.tokens_used || 0), 0);
    }
    tokensRemainingEl.textContent = formatTokenNumber(remaining);
    if (tokenResetEl) tokenResetEl.textContent = formatResetCountdown(state.token_reset_at);
  }

  async function refreshTokenHud() {
    try {
      if (!window.LegendaryBackend || !window.LegendaryBackend.getProfile) return;
      var profile = await window.LegendaryBackend.getProfile();

      if (!profile) {
        updateTokenHud(null);
        return;
      }

      var limit = Number(profile.token_limit);
      var used = Number(profile.tokens_used);
      var remaining = Number.isFinite(limit) && Number.isFinite(used)
        ? Math.max(limit - used, 0)
        : null;

      updateTokenHud({
        tokens_remaining: remaining,
        token_limit: limit,
        tokens_used: used,
        token_reset_at: profile.token_reset_at
      });

      // Do not replace the user's selected model with the plan default here.
      // refreshTokenHud() runs periodically and after auth/profile events; using
      // the plan default here made an explicitly selected Lite/Pro model appear
      // to "switch back" to Ultra for Legendary/Owner accounts.
      if (typeof settings !== 'undefined' && settings) {
        updateModeLabel();
      }
    } catch (_) {
      // Keep the last known value instead of replacing a valid token count
      // with a dash during a transient Supabase request.
    }
  }

  // Auth/profile can become ready after chat.js has already initialized.
  // Refresh immediately when the account is available instead of waiting 30s.
  window.addEventListener('legendary:profile-ready', refreshTokenHud);
  window.addEventListener('legendary:auth-changed', function () {
    setTimeout(refreshTokenHud, 50);
  });

  var SETTINGS_KEY = 'legendaryai_settings';
  var CONV_KEY = 'legendaryai_conversations_v2';
  var currentPlan = 'free';
  var currentRole = 'user';
  var reasoningEnabled = false;
  var MODEL_LABELS = {
    auto: 'Tự động · theo gói',
    'legendary-lite-1': 'LegendaryLite-1',
    'legendary-pro-1': 'LegendaryPro-1',
    'legendary-vision-pro-11b': 'Legendary Vision Pro 11B',
    'legendary-ultra-1': 'LegendaryUltra-1',
    custom: 'Custom Core',
    'legendary-reasoner-32b': 'Legendary Reasoner 32B',
    'legendary-ultra-120b': 'Legendary Ultra 120B',
    'legendary-vision-109b': 'Legendary Vision 109B'
  };
  var ACTIVE_KEY = 'legendaryai_active_conv_v2';
  var activeController = null;
  var pendingAttachments = [];

  // External AI provider configuration intentionally removed: Legendary Engine only.

  refreshTokenHud();
  window.setInterval(refreshTokenHud, 30000);

  // ---------------------------------------------------------------------
  // Settings (global, shared across conversations)
  // ---------------------------------------------------------------------
  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return Object.assign({
        mode: 'legendary',
        engineModel: 'auto',
        provider: 'legendary', endpoint: '', key: '', model: '', system: '',
        stream: true,
        reasoning: false
      }, parsed || {});
    } catch (e) {
      return {
        mode: 'legendary',
        engineModel: 'auto',
        provider: 'legendary', endpoint: '', key: '', model: '', system: '',
        stream: true
      };
    }
  }

  function saveSettingsToStorage(s) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (e) {
      /* ignore */
    }
  }

  var PROMPT_PRESETS = {
    default: '',
    coder: 'Bạn là kiến trúc sư phần mềm cấp cao. Ưu tiên giải pháp production-ready, bảo mật, testable và giải thích trade-off ngắn gọn.',
    research: 'Bạn là chuyên gia phân tích. Tách dữ kiện khỏi giả định, nêu mức độ chắc chắn và cấu trúc kết quả theo luận điểm → bằng chứng → kết luận.',
    writer: 'Bạn là biên tập viên cao cấp. Giữ đúng mục tiêu, đối tượng, giọng văn và cấu trúc; viết tự nhiên, không sáo rỗng.',
    concise: 'Trả lời ngắn gọn, trực tiếp, ưu tiên checklist hoặc các bước hành động. Không lặp lại đề bài.'
  };

  var settings = loadSettings();
  applySettingsToForm();
  updateModeLabel();
  syncEngineModelAccess();

  async function syncEngineModelAccess() {
    if (!engineModelSelect) return;

    var profile = null;

    try {
      profile = window.LegendaryBackend && window.LegendaryBackend.enabled
        ? await window.LegendaryBackend.getProfile()
        : null;
    } catch (e) {
      profile = null;
    }

    var plan = profile ? profile.plan : null;
    var role = profile ? profile.role : null;
    currentPlan = plan || 'free';
    currentRole = role || 'user';
    var options = engineModelSelect.options;

    for (var i = 0; i < options.length; i++) {
      var key = options[i].value;
      var allowed = true;

      if (key === 'auto') allowed = !!profile;
      else if (key === 'legendary-lite-1') allowed = true;
      else if (key === 'legendary-pro-1' || key === 'legendary-vision-pro-11b') allowed =
        role === 'owner' || plan === 'pro' || plan === 'legendary';
      else if (key === 'legendary-ultra-1') allowed =
        role === 'owner' || plan === 'legendary';
      else if (key === 'custom') allowed = role === 'owner';
      else if (key === 'legendary-reasoner-32b') allowed =
        role === 'owner' || plan === 'pro' || plan === 'legendary';
      else if (key === 'legendary-ultra-120b' || key === 'legendary-vision-109b') allowed =
        role === 'owner' || plan === 'legendary';

      options[i].disabled = !allowed;
    }

    var desired = settings.engineModel || 'auto';

    if (!profile) desired = 'auto';

    if (desired !== 'auto') {
      var desiredOption =
        engineModelSelect.querySelector('option[value="' + desired + '"]');

      if (!desiredOption || desiredOption.disabled) {
        desired = 'auto';
      }
    }

    engineModelSelect.value = desired;
    if (chatModelSelect) {
      for (var j = 0; j < chatModelSelect.options.length; j++) {
        var chatKey = chatModelSelect.options[j].value;
        var sourceOption = engineModelSelect.querySelector('option[value="' + chatKey + '"]');
        chatModelSelect.options[j].disabled = !!(sourceOption && sourceOption.disabled);
      }
      chatModelSelect.value = desired;
    }
  }

  function effectiveModelKey() {
    if (settings.engineModel && settings.engineModel !== 'auto') return settings.engineModel;
    if (currentRole === 'owner' || currentPlan === 'legendary') return 'legendary-ultra-1';
    if (currentPlan === 'pro') return 'legendary-pro-1';
    return 'legendary-lite-1';
  }

  function applySettingsToForm() {
    modeSelect.value = "legendary";
    if (engineModelSelect) engineModelSelect.value = settings.engineModel || "auto";
    if (chatModelSelect) chatModelSelect.value = settings.engineModel || "auto";
    if (systemPrompt) systemPrompt.value = settings.system || "";
    if (promptPresetSelect) promptPresetSelect.value = settings.preset || "default";
    reasoningEnabled = !!settings.reasoning;
    if (streamToggle) streamToggle.checked = false;
    if (reasoningToggle) {
      reasoningToggle.classList.toggle('active', reasoningEnabled);
      reasoningToggle.setAttribute('aria-pressed', reasoningEnabled ? 'true' : 'false');
    }
    if (providerSelect) { providerSelect.value = "legendary"; providerSelect.disabled = true; }
    if (apiEndpoint) { apiEndpoint.value = ""; apiEndpoint.disabled = true; }
    if (apiKey) { apiKey.value = ""; apiKey.disabled = true; }
    if (apiModel) { apiModel.value = ""; apiModel.disabled = true; }
  }

    function updateModeLabel() {
    chatModeLabel.textContent =
      "Legendary Engine · " +
      (settings.engineModel === "auto"
        ? (MODEL_LABELS[effectiveModelKey()] || "Auto")
        : (MODEL_LABELS[settings.engineModel] || settings.engineModel));
    if (chatDot) chatDot.classList.add("live");
  }

  settingsBtn.addEventListener('click', function () {
    settingsBackdrop.classList.add('open');
  });

  if (chatModelSelect) {
    chatModelSelect.addEventListener('change', function () {
      settings.engineModel = chatModelSelect.value;
      if (engineModelSelect) engineModelSelect.value = chatModelSelect.value;
      saveSettingsToStorage(settings);
      updateModeLabel();
    });
  }

  if (reasoningToggle) {
    reasoningToggle.addEventListener('click', function () {
      reasoningEnabled = !reasoningEnabled;
      settings.reasoning = reasoningEnabled;
      reasoningToggle.classList.toggle('active', reasoningEnabled);
      reasoningToggle.setAttribute('aria-pressed', reasoningEnabled ? 'true' : 'false');
      saveSettingsToStorage(settings);
      if (streamStatus) {
        streamStatus.textContent = reasoningEnabled
          ? 'Suy luận nâng cao · đang bật'
          : '';
      }
    });
  }

  if (promptPresetSelect) {
    promptPresetSelect.addEventListener('change', async function () {
      var profile = null;
      try {
        profile = window.LegendaryBackend && window.LegendaryBackend.enabled
          ? await window.LegendaryBackend.getProfile()
          : null;
      } catch (e) {}
      if (!profile || (profile.plan !== 'pro' && profile.plan !== 'legendary' && profile.role !== 'owner')) {
        promptPresetSelect.value = 'default';
        if (streamStatus) streamStatus.textContent = 'Prompt Studio cần gói Pro hoặc Legendary.';
        return;
      }
      var key = promptPresetSelect.value;
      if (systemPrompt && PROMPT_PRESETS[key] !== undefined) systemPrompt.value = PROMPT_PRESETS[key];
    });
  }

  closeSettings.addEventListener('click', function () {
    settingsBackdrop.classList.remove('open');
  });

  settingsBackdrop.addEventListener('click', function (e) {
    if (e.target === settingsBackdrop) {
      settingsBackdrop.classList.remove('open');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      settingsBackdrop.classList.remove('open');

      if (chatApp.classList.contains('chat-app--full')) {
        chatApp.classList.remove('chat-app--full');
        document.body.classList.remove('chat-fullscreen-active');

        if (expandChatBtn) {
          expandChatBtn.textContent = '⤢';
        }
      }
    }
  });

  saveSettings.addEventListener('click', function () {
    settings = {
      mode: "legendary",
      engineModel: engineModelSelect ? engineModelSelect.value : "auto",
      provider: "legendary",
      endpoint: "",
      key: "",
      model: "",
      system: systemPrompt ? systemPrompt.value.trim() : "",
      preset: promptPresetSelect ? promptPresetSelect.value : "default",
      stream: false,
      reasoning: reasoningEnabled
    };
    saveSettingsToStorage(settings);
    updateModeLabel();
    syncEngineModelAccess();
    settingsBackdrop.classList.remove("open");
  });

  // ---------------------------------------------------------------------
  // Conversations (multi-thread, persisted per browser)
  // ---------------------------------------------------------------------
  function uid() {
    return (
      'c' +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function makeNewConversation() {
    return {
      id: uid(),
      title: 'Cuộc trò chuyện mới',
      slug: 'cuoc-tro-chuyen',
      createdAt: Date.now(),
      draft: true,
      messages: [
        {
          role: 'ai',
          text: 'Xin chào, tôi là Legendary AI. Bạn muốn bắt đầu với điều gì hôm nay?',
          attachments: []
        }
      ]
    };
  }

  function loadConversations() {
    try {
      var raw = localStorage.getItem(CONV_KEY);
      var list = raw ? JSON.parse(raw) : null;

      if (Array.isArray(list) && list.length) {
        return list;
      }
    } catch (e) {
      /* ignore */
    }

    return [makeNewConversation()];
  }

  var conversations = loadConversations();

  function slugify(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .toLowerCase()
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'cuoc-tro-chuyen';
  }

  function routeSlug() {
    var path = window.location.pathname.replace(/\/+$/, '') || '/';
    var match = path.match(/^\/chat\/([^/]+)$/i);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch (e) {
      return match[1];
    }
  }

  function isNewRoute() {
    return /^\/new\/?$/i.test(window.location.pathname);
  }

  function uniqueConversationSlug(conv) {
    var base = slugify(conv.title);
    var candidate = base;
    var n = 2;

    while (conversations.some(function (other) {
      return other.id !== conv.id && other.slug === candidate;
    })) {
      candidate = base + '-' + n++;
    }

    conv.slug = candidate;
    return candidate;
  }

  function ensureConversationSlugs() {
    conversations.forEach(function (conv) {
      if (!conv.slug) uniqueConversationSlug(conv);
    });
  }

  ensureConversationSlugs();

  var requestedSlug = routeSlug();
  var activeId = null;

  if (requestedSlug) {
    var routed = conversations.find(function (conv) {
      return conv.slug === requestedSlug;
    });

    if (!routed) {
      routed = {
        id: uid(),
        title: requestedSlug
          .split('-')
          .map(function (part) {
            return part ? part.charAt(0).toUpperCase() + part.slice(1) : '';
          })
          .join(' ') || 'Cuộc trò chuyện mới',
        slug: requestedSlug,
        createdAt: Date.now(),
        messages: [{
          role: 'ai',
          text: 'Xin chào! Đây là cuộc trò chuyện ' +
            requestedSlug + '. Bạn muốn bắt đầu với điều gì?',
          attachments: []
        }]
      };
      conversations.unshift(routed);
    }

    activeId = routed.id;
  } else if (isNewRoute()) {
    var fresh = makeNewConversation();
    uniqueConversationSlug(fresh);
    conversations.unshift(fresh);
    activeId = fresh.id;
  } else {
    try {
      activeId = localStorage.getItem(ACTIVE_KEY);
    } catch (e) {
      /* ignore */
    }

    if (!activeId || !conversations.some(function (conv) {
      return conv.id === activeId;
    })) {
      activeId = conversations[0].id;
    }
  }

  // Normalize legacy /chat/:slug and /new links back to the canonical homepage URL.
  if (window.location.pathname !== '/') {
    window.history.replaceState({ canonical: true }, '', '/');
  }

  function syncRouteForConversation(conv, replace) {
    if (!conv) return;
    if (!conv.slug || conv.slug !== slugify(conv.title)) {
      uniqueConversationSlug(conv);
    }

    // LegendaryAI intentionally keeps the public URL at the homepage.
    // Conversation state is persisted locally/Supabase instead of exposing
    // conversation slugs in the browser URL.
    if (window.location.pathname !== '/') {
      window.history.replaceState({ conversationId: conv.id }, '', '/');
    }
  }

  function goToNewRoute() {
    if (window.location.pathname !== '/') {
      window.history.replaceState({ newConversation: true }, '', '/');
    }
  }

  function persistConversations() {
    try {
      var stored = conversations
        .filter(function (conv) { return !conv.draft; })
        .map(function (conv) {
          var copy = Object.assign({}, conv);
          copy.messages = (conv.messages || []).map(function (m) {
            var next = Object.assign({}, m);
            next.text = String(next.text || '').slice(0, 120000);
            next.attachments = (next.attachments || []).map(function (a) {
              var item = Object.assign({}, a);
              // Base64 images can exhaust localStorage very quickly.
              // Keep small previews, but strip oversized binary payloads from
              // persisted history so one large image cannot break all saves.
              if ((item.kind === 'image' || item.kind === 'generated-image') &&
                  item.dataUrl && item.dataUrl.length > 180000) {
                item.dataUrl = '';
                item.persisted = false;
              }
              if ((item.kind === 'text' || item.kind === 'archive') && item.textContent) {
                item.textContent = String(item.textContent).slice(0, 30000);
              }
              return item;
            });
            return next;
          });
          return copy;
        });

      var serialized = JSON.stringify(stored);

      // Stay below typical browser localStorage quotas. If a conversation
      // history is unusually large, retain recent messages rather than
      // silently losing the entire save.
      if (serialized.length > 3500000) {
        stored = stored.map(function (conv) {
          var copy = Object.assign({}, conv);
          copy.messages = (conv.messages || []).slice(-60).map(function (m) {
            var next = Object.assign({}, m);
            next.text = String(next.text || '').slice(0, 20000);
            next.attachments = (next.attachments || []).map(function (a) {
              var item = Object.assign({}, a);
              if (item.dataUrl) {
                item.dataUrl = '';
                item.persisted = false;
              }
              if (item.textContent) item.textContent = String(item.textContent).slice(0, 12000);
              return item;
            });
            return next;
          });
          return copy;
        });
        serialized = JSON.stringify(stored);
      }

      localStorage.setItem(CONV_KEY, serialized);
    } catch (e) {
      // Storage quotas, private-mode restrictions, or malformed legacy data
      // should never break the chat UI.
    }
  }

  function persistActiveId() {
    try {
      localStorage.setItem(ACTIVE_KEY, activeId);
    } catch (e) {
      /* ignore */
    }
  }

  function findConv(id) {
    for (var i = 0; i < conversations.length; i++) {
      if (conversations[i].id === id) {
        return conversations[i];
      }
    }

    return null;
  }

  function getActiveConv() {
    return findConv(activeId) || conversations[0];
  }

  function autoTitle(conv, text, attachments) {
    if (conv.title !== 'Cuộc trò chuyện mới') return;

    var t = (text || '').trim();

    if (!t && attachments && attachments.length) {
      t = attachments[0].name;
    }

    if (!t) return;

    conv.title = t.length > 42
      ? t.slice(0, 42) + '…'
      : t;

    uniqueConversationSlug(conv);
  }

  function newConversation() {
    var conv = makeNewConversation();

    conversations.unshift(conv);
    activeId = conv.id;
    uniqueConversationSlug(conv);
    persistActiveId();
    goToNewRoute();

    renderSidebar();
    renderMessages();
    closeSidebarMobile();

    chatInput.focus();
  }

  function switchConversation(id) {
    if (id === activeId) {
      closeSidebarMobile();
      return;
    }

    activeId = id;

    persistActiveId();
    syncRouteForConversation(findConv(id), true);
    renderSidebar();
    renderMessages();
    closeSidebarMobile();
  }

  function deleteConversation(id) {
    var idx = -1;

    for (var i = 0; i < conversations.length; i++) {
      if (conversations[i].id === id) {
        idx = i;
        break;
      }
    }

    if (idx === -1) return;

    if (!window.confirm('Xoá hội thoại này? Không thể hoàn tác.')) {
      return;
    }

    conversations.splice(idx, 1);

    if (!conversations.length) {
      conversations.push(makeNewConversation());
    }

    if (activeId === id) {
      activeId = conversations[0].id;
    }

    persistConversations();
    persistActiveId();

    renderSidebar();
    renderMessages();
  }

  function renameConversationTitle(id, newTitle) {
    var conv = findConv(id);

    if (!conv) return;

    conv.title =
      (newTitle || '').trim().slice(0, 60) ||
      'Cuộc trò chuyện mới';

    uniqueConversationSlug(conv);
    persistConversations();

    if (conv.id === activeId) {
      syncRouteForConversation(conv, true);
    }

    renderSidebar();
  }

  function closeSidebarMobile() {
    chatApp.classList.remove('sidebar-open');

    if (sidebarToggle) {
      sidebarToggle.setAttribute('aria-expanded', 'false');
    }
  }

  function renderSidebar() {
    if (!convList) return;

    convList.innerHTML = '';

    var sorted = conversations
      .slice()
      .sort(function (a, b) {
        return b.createdAt - a.createdAt;
      });

    sorted.forEach(function (conv) {
      var item = document.createElement('div');

      item.className =
        'conv-item' +
        (conv.id === activeId ? ' active' : '');

      var title = document.createElement('span');
      title.className = 'conv-title';
      title.textContent = conv.title;
      title.title = conv.title;

      title.addEventListener('dblclick', function (e) {
        e.stopPropagation();

        var input = document.createElement('input');

        input.type = 'text';
        input.className = 'conv-title-input';
        input.value = conv.title;

        item.replaceChild(input, title);

        input.focus();
        input.select();

        var committed = false;

        function commit() {
          if (committed) return;

          committed = true;
          renameConversationTitle(conv.id, input.value);
        }

        input.addEventListener('blur', commit);

        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            input.blur();
          }

          if (ev.key === 'Escape') {
            committed = true;
            renderSidebar();
          }
        });
      });

      var del = document.createElement('button');

      del.type = 'button';
      del.className = 'conv-del';
      del.title = 'Xoá hội thoại';

      del.setAttribute(
        'aria-label',
        'Xoá hội thoại "' + conv.title + '"'
      );

      del.textContent = '✕';

      del.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteConversation(conv.id);
      });

      item.appendChild(title);
      item.appendChild(del);

      item.addEventListener('click', function () {
        switchConversation(conv.id);
      });

      convList.appendChild(item);
    });
  }

  if (newChatBtn) {
    newChatBtn.addEventListener('click', newConversation);
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function () {
      var open = chatApp.classList.toggle('sidebar-open');

      sidebarToggle.setAttribute(
        'aria-expanded',
        open ? 'true' : 'false'
      );
    });
  }

  if (expandChatBtn) {
    expandChatBtn.addEventListener('click', function () {
      var full = chatApp.classList.toggle('chat-app--full');

      document.body.classList.toggle(
        'chat-fullscreen-active',
        full
      );

      expandChatBtn.textContent = full ? '⤡' : '⤢';

      expandChatBtn.title =
        full ? 'Thu nhỏ' : 'Phóng to toàn màn hình';

      chatWindow.scrollTop = chatWindow.scrollHeight;
    });
  }

  function exportActiveConversation() {
    (async function () {
      var profile = null;
      try {
        profile = window.LegendaryBackend && window.LegendaryBackend.enabled
          ? await window.LegendaryBackend.getProfile()
          : null;
      } catch (e) {}
      if (!profile || (profile.plan !== 'pro' && profile.plan !== 'legendary' && profile.role !== 'owner')) {
        if (streamStatus) streamStatus.textContent = 'Xuất hội thoại cần gói Pro hoặc Legendary.';
        return;
      }
      var conv = getActiveConv();
      if (!conv) return;
      var lines = ['# ' + conv.title, '', 'Xuất từ LegendaryAI', ''];
      conv.messages.forEach(function (m) {
        lines.push(m.role === 'user' ? '## Bạn' : '## LegendaryAI');
        lines.push(m.text || '');
        if (m.attachments && m.attachments.length) {
          lines.push('');
          lines.push('Tệp đính kèm: ' + m.attachments.map(function (a) { return a.name; }).join(', '));
        }
        lines.push('');
      });
      var blob = new Blob([lines.join('\n')], {type:'text/markdown;charset=utf-8'});
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (slugify(conv.title) || 'legendary-chat') + '.md';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (streamStatus) streamStatus.textContent = '✓ Đã xuất hội thoại Markdown.';
    })();
  }

  if (exportChatBtn) exportChatBtn.addEventListener('click', exportActiveConversation);

  // ---------------------------------------------------------------------
  // Markdown-lite renderer with headings/lists/quotes/tables/code blocks
  // ---------------------------------------------------------------------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function inlineFormat(escapedStr) {
    var s = escapedStr;

    s = s.replace(
      /`([^`]+)`/g,
      '<code>$1</code>'
    );

    s = s.replace(
      /\*\*([^*]+)\*\*/g,
      '<strong>$1</strong>'
    );

    s = s.replace(
      /(^|[^*])\*([^*\n]+)\*(?!\*)/g,
      '$1<em>$2</em>'
    );

    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    return s;
  }

  function splitTableRow(line) {
    var parts = line
      .split('|')
      .map(function (c) {
        return c.trim();
      });

    if (parts.length && parts[0] === '') {
      parts.shift();
    }

    if (
      parts.length &&
      parts[parts.length - 1] === ''
    ) {
      parts.pop();
    }

    return parts;
  }

  function renderMarkdown(raw) {
    if (!raw) return '<p></p>';

    var codeBlocks = [];

    var text = raw.replace(
      /```([a-zA-Z0-9+#_-]*)\n?([\s\S]*?)```/g,
      function (m, lang, code) {
        var idx = codeBlocks.length;

        codeBlocks.push({
          lang: (lang || '').trim(),
          code: code.replace(/\n$/, '')
        });

        return '\u0000CODEBLOCK' + idx + '\u0000';
      }
    );

    var lines = text.split('\n');
    var html = '';
    var paraBuf = [];

    function flushPara() {
      if (!paraBuf.length) return;

      html +=
        '<p>' +
        inlineFormat(
          escapeHtml(paraBuf.join('\n'))
        ).replace(/\n/g, '<br>') +
        '</p>';

      paraBuf = [];
    }

    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      var codeMatch =
        line.match(/^\u0000CODEBLOCK(\d+)\u0000$/);

      if (codeMatch) {
        flushPara();

        var block =
          codeBlocks[parseInt(codeMatch[1], 10)];

        var langLabel = block.lang || 'text';

        var langClass = block.lang
          ? ' class="language-' +
            block.lang.replace(/[^a-zA-Z0-9]/g, '') +
            '"'
          : '';

        html +=
          '<div class="code-block">' +
            '<div class="code-block-head">' +
              '<span>' +
                escapeHtml(langLabel) +
              '</span>' +
              '<button type="button" class="code-copy">Sao chép</button>' +
            '</div>' +
            '<pre><code' +
              langClass +
              '>' +
              escapeHtml(block.code) +
            '</code></pre>' +
          '</div>';

        i++;
        continue;
      }

      if (/^\s*$/.test(line)) {
        flushPara();
        i++;
        continue;
      }

      var h = line.match(
        /^(#{1,6})\s+(.*)$/
      );

      if (h) {
        flushPara();

        var level = h[1].length;

        html +=
          '<h' +
          level +
          '>' +
          inlineFormat(escapeHtml(h[2])) +
          '</h' +
          level +
          '>';

        i++;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        flushPara();

        var quoteLines = [];

        while (
          i < lines.length &&
          /^\s*>\s?/.test(lines[i])
        ) {
          quoteLines.push(
            lines[i].replace(/^\s*>\s?/, '')
          );

          i++;
        }

        html +=
          '<blockquote>' +
          inlineFormat(
            escapeHtml(quoteLines.join('\n'))
          ).replace(/\n/g, '<br>') +
          '</blockquote>';

        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        flushPara();

        var items = [];

        while (
          i < lines.length &&
          /^\s*[-*]\s+/.test(lines[i])
        ) {
          items.push(
            lines[i].replace(/^\s*[-*]\s+/, '')
          );

          i++;
        }

        html +=
          '<ul>' +
          items.map(function (it) {
            return (
              '<li>' +
              inlineFormat(escapeHtml(it)) +
              '</li>'
            );
          }).join('') +
          '</ul>';

        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        flushPara();

        var oitems = [];

        while (
          i < lines.length &&
          /^\s*\d+\.\s+/.test(lines[i])
        ) {
          oitems.push(
            lines[i].replace(/^\s*\d+\.\s+/, '')
          );

          i++;
        }

        html +=
          '<ol>' +
          oitems.map(function (it) {
            return (
              '<li>' +
              inlineFormat(escapeHtml(it)) +
              '</li>'
            );
          }).join('') +
          '</ol>';

        continue;
      }

      if (
        line.indexOf('|') !== -1 &&
        lines[i + 1] &&
        /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(
          lines[i + 1]
        )
      ) {
        flushPara();

        var headerCells = splitTableRow(line);

        i += 2;

        var rows = [];

        while (
          i < lines.length &&
          lines[i].indexOf('|') !== -1 &&
          lines[i].trim() !== ''
        ) {
          rows.push(splitTableRow(lines[i]));
          i++;
        }

        html +=
          '<table>' +
            '<thead>' +
              '<tr>' +
                headerCells.map(function (c) {
                  return (
                    '<th>' +
                    inlineFormat(escapeHtml(c)) +
                    '</th>'
                  );
                }).join('') +
              '</tr>' +
            '</thead>' +
            '<tbody>' +
              rows.map(function (r) {
                return (
                  '<tr>' +
                  r.map(function (c) {
                    return (
                      '<td>' +
                      inlineFormat(escapeHtml(c)) +
                      '</td>'
                    );
                  }).join('') +
                  '</tr>'
                );
              }).join('') +
            '</tbody>' +
          '</table>';

        continue;
      }

      paraBuf.push(line);
      i++;
    }

    flushPara();

    return html || '<p></p>';
  }

  function enhanceCodeBlocks(bubble) {
    if (!window.hljs) return;

    var nodes = bubble.querySelectorAll('pre code');

    for (var i = 0; i < nodes.length; i++) {
      try {
        window.hljs.highlightElement(nodes[i]);
      } catch (e) {
        /* ignore */
      }
    }
  }

  // Copy code-block contents via delegated click handler.
  chatWindow.addEventListener('click', function (e) {
    var btn =
      e.target.closest &&
      e.target.closest('.code-copy');

    if (!btn) return;

    var block = btn.closest('.code-block');
    var codeEl = block && block.querySelector('code');

    if (!codeEl || !navigator.clipboard) return;

    navigator.clipboard
      .writeText(codeEl.textContent)
      .then(function () {
        var prev = btn.textContent;

        btn.textContent = 'Đã chép ✓';

        setTimeout(function () {
          btn.textContent = prev;
        }, 1200);
      })
      .catch(function () {
        /* ignore */
      });
  });

  // ---------------------------------------------------------------------
  // Message rendering
  // ---------------------------------------------------------------------
  function attachmentsHtml(attachments) {
    if (!attachments || !attachments.length) return '';

    var html = '<div class="msg-attachments">';

    attachments.forEach(function (a) {
      if (a.kind === 'image' || a.kind === 'generated-image') {
        html +=
          '<img class="att-thumb" src="' +
          a.dataUrl +
          '" alt="' +
          escapeHtml(a.name) +
          '">';
      } else {
        html +=
          '<span class="att-file">📄 ' +
          escapeHtml(a.name) +
          '</span>';
      }
    });

    html += '</div>';

    return html;
  }

  function attachMsgActions(wrap, text, isLast) {
    var actions = document.createElement('div');
    actions.className = 'msg-actions';

    var copyBtn = document.createElement('button');

    copyBtn.type = 'button';
    copyBtn.title = 'Sao chép';
    copyBtn.textContent = '⧉';

    copyBtn.addEventListener('click', function () {
      if (
        navigator.clipboard &&
        navigator.clipboard.writeText
      ) {
        navigator.clipboard
          .writeText(text)
          .then(function () {
            copyBtn.textContent = '✓';

            setTimeout(function () {
              copyBtn.textContent = '⧉';
            }, 1200);
          })
          .catch(function () {
            /* ignore */
          });
      }
    });

    actions.appendChild(copyBtn);

    if (isLast) {
      var regenBtn =
        document.createElement('button');

      regenBtn.type = 'button';
      regenBtn.title = 'Tạo lại phản hồi';
      regenBtn.setAttribute(
        'aria-label',
        'Tạo lại phản hồi'
      );
      regenBtn.setAttribute('data-regen', '1');
      regenBtn.textContent = '🔁';

      regenBtn.addEventListener(
        'click',
        regenerateLast
      );

      actions.appendChild(regenBtn);
    }

    wrap.appendChild(actions);
  }

  function renderMessageDom(
    role,
    text,
    attachments,
    isLast
  ) {
    var wrap = document.createElement('div');

    wrap.className =
      'msg ' +
      (role === 'user'
        ? 'msg-user'
        : 'msg-ai');

    wrap.style.position = 'relative';

    var avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'user' ? 'B' : 'L';

    var bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    var attHtml = attachmentsHtml(attachments);

    if (role === 'user') {
      bubble.innerHTML =
        attHtml +
        (text
          ? '<p>' + escapeHtml(text) + '</p>'
          : '');
    } else {
      bubble.innerHTML =
        attHtml +
        renderMarkdown(text || '');

      enhanceCodeBlocks(bubble);
    }

    wrap.appendChild(avatar);
    wrap.appendChild(bubble);

    chatWindow.appendChild(wrap);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    if (role !== 'user' && text) {
      attachMsgActions(
        wrap,
        text,
        !!isLast
      );
    }

    return {
      wrap: wrap,
      bubble: bubble
    };
  }

  function renderMessages() {
    chatWindow.innerHTML = '';

    var conv = getActiveConv();
    var lastAiIdx = -1;

    conv.messages.forEach(function (m, idx) {
      if (m.role === 'ai') {
        lastAiIdx = idx;
      }
    });

    conv.messages.forEach(function (m, idx) {
      renderMessageDom(
        m.role,
        m.text,
        m.attachments,
        idx === lastAiIdx
      );
    });

    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function addMessage(role, text, attachments) {
    var conv = getActiveConv();
    var atts = attachments || [];

    conv.messages.push({
      role: role,
      text: text,
      attachments: atts
    });

    if (role === 'user') {
      conv.draft = false;
      autoTitle(conv, text, atts);
    }

    persistConversations();
    renderSidebar();

    return renderMessageDom(
      role,
      text,
      atts,
      false
    );
  }

  function addTypingBubble() {
    var wrap = document.createElement('div');

    wrap.className = 'msg msg-ai';
    wrap.style.position = 'relative';

    var avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = 'L';

    var bubble = document.createElement('div');
    bubble.className = 'msg-bubble typing';
    bubble.textContent = 'Đang soạn câu trả lời…';

    wrap.appendChild(avatar);
    wrap.appendChild(bubble);

    chatWindow.appendChild(wrap);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    return {
      wrap: wrap,
      bubble: bubble,
      raw: '',
      convId: activeId
    };
  }

  function finalizeAiBubble(state) {
    state.bubble.classList.remove('typing');

    if (!state.raw) {
      state.bubble.textContent =
        'Không nhận được phản hồi hợp lệ từ API.';

      state.bubble.classList.add('error');

      return;
    }

    state.bubble.innerHTML =
      renderMarkdown(state.raw);

    enhanceCodeBlocks(state.bubble);

    var conv =
      findConv(state.convId) ||
      getActiveConv();

    conv.messages.push({
      role: 'ai',
      text: state.raw,
      attachments: []
    });

    persistConversations();

    if (conv.id === activeId) {
      var oldRegen =
        chatWindow.querySelector(
          '.msg-actions button[data-regen]'
        );

      if (oldRegen) {
        oldRegen.remove();
      }

      attachMsgActions(
        state.wrap,
        state.raw,
        true
      );
    }
  }

  function setErrorBubble(state, message) {
    state.bubble.classList.remove('typing');
    state.bubble.classList.add('error');
    state.bubble.textContent = message;
  }

  function getLastUserMessageText(conv) {
    for (
      var i = conv.messages.length - 1;
      i >= 0;
      i--
    ) {
      if (conv.messages[i].role === 'user') {
        return conv.messages[i].text;
      }
    }

    return '';
  }

  function regenerateLast() {
    if (sendBtn.disabled) return;

    var conv = getActiveConv();
    var idx = conv.messages.length - 1;

    if (
      idx < 0 ||
      conv.messages[idx].role !== 'ai'
    ) {
      return;
    }

    conv.messages.splice(idx, 1);
    persistConversations();

    var lastWrap =
      chatWindow.querySelector('.msg:last-child');

    if (lastWrap) {
      lastWrap.remove();
    }

    triggerAssistantResponse();
  }

  // ---------------------------------------------------------------------
  // Demo mode: canned, topic-aware replies (no network calls)
  // ---------------------------------------------------------------------
  var demoReplies = [
    {
      match: /(mã|code|lập trình|debug)/i,
      reply:
        'Ở chế độ mô phỏng mình chưa thể chạy mã thật, nhưng ở chế độ AI thật, Legendary AI có thể đọc lỗi, đề xuất sửa và viết lại hàm cho bạn theo ngôn ngữ bạn đang dùng.\n\n```js\nfunction vidu(a, b) {\n  return a + b;\n}\n```'
    },
    {
      match: /(tài liệu|báo cáo|hợp đồng|viết|email)/i,
      reply:
        'Legendary AI có thể hỗ trợ soạn thảo tài liệu theo đúng giọng văn và cấu trúc bạn cần — chỉ cần mô tả mục đích, đối tượng đọc và độ dài mong muốn.'
    },
    {
      match: /(tìm kiếm|tra cứu|thông tin mới)/i,
      reply:
        'LegendaryAI hiện không bật web search mặc định; khi có search gateway thật, tính năng này mới được kích hoạt.'
    },
    {
      match: /(token|giá|gói|pricing|so sánh)/i,
      reply:
        'Gói Legendary cấp hạn mức tối đa **6.000.000 token mỗi cửa sổ 18 giờ**. Bạn có thể xem chi tiết các gói ở phần "Chọn gói phù hợp" phía dưới, hoặc bảng so sánh ở phần "So sánh".'
    },
    {
      match: /(xin chào|hello|hi|chào)/i,
      reply:
        'Chào bạn! Mình là Legendary AI. Bạn có thể hỏi mình về lập trình, viết tài liệu, tìm kiếm thông tin hoặc bất cứ điều gì bạn đang làm.'
    }
  ];

  function getDemoReply(userText) {
    for (var i = 0; i < demoReplies.length; i++) {
      if (
        demoReplies[i].match.test(userText || '')
      ) {
        return demoReplies[i].reply;
      }
    }

    return 'LegendaryAI đang chạy Local Sandbox nên không gọi Claude, ChatGPT hoặc API AI bên ngoài. Chế độ này dùng để kiểm tra hệ thống mà không cần API key thật.';
  }

  // External AI client path removed. All AI requests use Legendary Engine.

  function buildMessageContent(message) {
    var text = String((message && message.text) || '');
    var attachments = (message && message.attachments) || [];
    if (!attachments.length) return text;

    var parts = [];
    if (text) parts.push({ type: 'text', text: text });

    attachments.forEach(function (a) {
      if (!a) return;
      if (a.kind === 'text' && a.textContent) {
        parts.push({ type: 'text', text: '\n\n[File: ' + (a.name || 'attachment') + ']\n' + a.textContent });
      } else if (a.kind === 'image' && a.dataUrl) {
        parts.push({ type: 'image', image: a.dataUrl, name: a.name || 'image' });
      } else {
        parts.push({ type: 'text', text: '\n\n[Attachment: ' + (a.name || 'file') + ']' });
      }
    });
    return parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
  }

  function callLegendaryEngine(conv) {
    var typing = addTypingBubble();

    var controller = new AbortController();
    activeController = controller;
    toggleBusyUI(true);

    if (streamStatus) {
      streamStatus.textContent =
        'Legendary Engine đang suy luận…';
    }

    var messages = conv.messages.map(
      function (m) {
        return {
          role:
            m.role === 'ai'
              ? 'assistant'
              : 'user',
          content:
            buildMessageContent(m, 'openai')
        };
      }
    );

    window.LegendaryAIEngine.chat({
      model:
        settings.engineModel ||
        'auto',
      messages: messages,
      system: settings.system || '',
      temperature: 0.35,
      max_tokens: 8192,
      reasoning: reasoningEnabled,
      signal: controller.signal
    })
      .then(function (result) {
        typing.raw = result.text || '';

        finalizeAiBubble(typing);

        toggleBusyUI(false);

        if (streamStatus) {
          var brain = result && result.brain;
          streamStatus.textContent = brain
            ? '✓ ' + (result.displayModel || 'Legendary Engine') +
              ' · ' + (brain.intent || 'general') +
              (brain.memory ? ' · memory' : '')
            : '';
        }

        if (result && result.usage) {
          updateTokenHud(result.usage);
        }

        if (chatModeLabel && result && result.displayModel) {
          chatModeLabel.textContent =
            'Legendary Engine · ' + result.displayModel;
        }
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') {
          setErrorBubble(typing, 'Đã dừng phản hồi.');
        } else {
          setErrorBubble(
            typing,
            'Legendary Engine: ' +
              (err && err.message
                ? err.message
                : err)
          );
        }

        toggleBusyUI(false);

        if (activeController === controller) {
          activeController = null;
        }

        if (streamStatus) {
          streamStatus.textContent = '';
        }
      })
      .finally(function () {
        if (activeController === controller) {
          activeController = null;
        }
      });
  }

  function isImageGenerationPrompt(text) {
    return /(?:\\b(?:tạo|vẽ|generate|draw|create)\\b.*\\b(?:ảnh|hình|image|picture)\\b|\\b(?:ảnh|hình|image|picture)\\b.*\\b(?:tạo|vẽ|generate|draw|create)\\b)/i.test(String(text || ''));
  }

  function callImageProvider(conv) {
    var typing = addTypingBubble();
    var controller = new AbortController();
    activeController = controller;
    toggleBusyUI(true);

    if (streamStatus) streamStatus.textContent = 'Image Provider đang tạo ảnh…';

    var prompt = getLastUserMessageText(conv);
    window.LegendaryAIEngine.image({
      prompt: prompt,
      size: 'auto',
      quality: 'auto',
      background: 'auto',
      signal: controller.signal
    })
      .then(function (result) {
        var dataUrl = result && result.imageDataUrl;
        if (!dataUrl) throw new Error('Image Provider không trả về dữ liệu ảnh.');

        typing.bubble.classList.remove('typing');
        typing.bubble.innerHTML =
          '<div class="generated-image-wrap">' +
          '<img class="generated-image" src="' + dataUrl + '" alt="' + escapeHtml(prompt) + '">' +
          '<div class="generated-image-meta">GPT Image 2 · Image Provider</div>' +
          '</div>';

        var savedText = 'Đã tạo ảnh bằng GPT Image 2.\n\nPrompt: ' + prompt;
        var convSaved = findConv(typing.convId) || getActiveConv();
        convSaved.messages.push({
          role: 'ai',
          text: savedText,
          attachments: [{ kind: 'generated-image', dataUrl: dataUrl, name: 'legendary-image.png' }]
        });
        persistConversations();

        if (streamStatus) streamStatus.textContent = '✓ GPT Image 2 · Image Provider';
        if (chatModeLabel) chatModeLabel.textContent = 'Image Provider · GPT Image 2';
        toggleBusyUI(false);
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') {
          setErrorBubble(typing, 'Đã dừng tạo ảnh.');
        } else {
          setErrorBubble(typing, 'Image Provider: ' + (err && err.message ? err.message : err));
        }
        toggleBusyUI(false);
        if (streamStatus) streamStatus.textContent = '';
      })
      .finally(function () {
        if (activeController === controller) activeController = null;
      });
  }

  function triggerAssistantResponse() {
    var conv = getActiveConv();
    var prompt = getLastUserMessageText(conv);

    if (window.LegendaryAIEngine) {
      if (isImageGenerationPrompt(prompt)) {
        callImageProvider(conv);
      } else {
        callLegendaryEngine(conv);
      }
      return;
    }

    var typing = addTypingBubble();
    setTimeout(function () {
      typing.raw = "Legendary Engine chưa được tải. Hãy tải lại trang và thử lại.";
      finalizeAiBubble(typing);
    }, 300);
  }

  function toggleBusyUI(busy) {
    sendBtn.disabled = busy;

    if (stopBtn) {
      stopBtn.hidden = !busy;
    }
  }

  if (stopBtn) {
    stopBtn.addEventListener(
      'click',
      function () {
        if (activeController) {
          activeController.abort();
        }

        toggleBusyUI(false);
      }
    );
  }

  if (clearChatBtn) {
    clearChatBtn.addEventListener(
      'click',
      function () {
        var conv = getActiveConv();

        conv.messages = [
          {
            role: 'ai',
            text:
              'Đã xoá hội thoại này. Bạn muốn bắt đầu với điều gì?',
            attachments: []
          }
        ];

        persistConversations();
        renderSidebar();
        renderMessages();
      }
    );
  }

  if (suggestionsWrap) {
    suggestionsWrap.addEventListener(
      'click',
      function (e) {
        var btn =
          e.target.closest &&
          e.target.closest(
            'button[data-suggest]'
          );

        if (!btn) return;

        chatInput.value =
          btn.getAttribute('data-suggest');

        chatInput.dispatchEvent(
          new Event('input')
        );

        chatForm.requestSubmit();
      }
    );
  }

  // ---------------------------------------------------------------------
  // Attachments (images + text/code files + ZIP)
  // ---------------------------------------------------------------------
  var MAX_TEXT_ATTACHMENT_CHARS = 120000;
  var TEXT_FILE_EXTENSIONS = /\.(txt|md|markdown|csv|json|jsonl|log|js|jsx|ts|tsx|py|java|c|h|cpp|hpp|cs|go|rs|php|rb|swift|kt|kts|html|htm|css|scss|sass|xml|yaml|yml|toml|ini|env|sql|sh|bat|ps1|vue|svelte|astro|graphql|gql)$/i;

  function renderAttachPreview() {
    if (!attachPreview) return;

    if (!pendingAttachments.length) {
      attachPreview.hidden = true;
      attachPreview.innerHTML = '';
      return;
    }

    attachPreview.hidden = false;
    attachPreview.innerHTML = '';

    pendingAttachments.forEach(function (a, idx) {
      var chip = document.createElement('span');
      chip.className = 'att-chip';

      if (a.kind === 'image') {
        var img = document.createElement('img');
        img.src = a.dataUrl;
        img.alt = a.name;
        chip.appendChild(img);
      } else if (a.kind === 'archive') {
        chip.appendChild(document.createTextNode('🗜️ '));
      } else {
        chip.appendChild(document.createTextNode('📄 '));
      }

      var nameSpan = document.createElement('span');
      nameSpan.className = 'att-name';
      nameSpan.textContent = a.name;
      chip.appendChild(nameSpan);

      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'att-remove';
      rm.title = 'Bỏ tệp này';
      rm.setAttribute('aria-label', 'Bỏ tệp ' + a.name);
      rm.textContent = '✕';
      rm.addEventListener('click', function () {
        pendingAttachments.splice(idx, 1);
        renderAttachPreview();
      });

      chip.appendChild(rm);
      attachPreview.appendChild(chip);
    });
  }

  function trimAttachmentText(text) {
    text = String(text || '');
    if (text.length <= MAX_TEXT_ATTACHMENT_CHARS) return text;
    return text.slice(0, MAX_TEXT_ATTACHMENT_CHARS) +
      '\n\n… [Phần còn lại của tệp đã được cắt để tránh làm nặng phiên chat]';
  }

  function readTextFile(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve({
          name: file.name,
          kind: 'text',
          mediaType: file.type || 'text/plain',
          textContent: trimAttachmentText(reader.result || '')
        });
      };
      reader.onerror = function () {
        resolve({
          name: file.name,
          kind: 'file',
          mediaType: file.type || 'application/octet-stream'
        });
      };
      reader.readAsText(file);
    });
  }

  async function readZipFile(file) {
    if (!window.JSZip) {
      throw new Error('ZIP reader chưa tải xong. Hãy thử lại sau vài giây.');
    }

    var zip = await window.JSZip.loadAsync(file);
    var names = Object.keys(zip.files);
    var textParts = [];
    var totalChars = 0;
    var maxFiles = 120;

    for (var i = 0; i < names.length && i < maxFiles; i++) {
      var name = names[i];
      var entry = zip.files[name];

      if (entry.dir) continue;
      if (!TEXT_FILE_EXTENSIONS.test(name)) continue;

      var remaining = MAX_TEXT_ATTACHMENT_CHARS - totalChars;
      if (remaining <= 0) break;

      try {
        var content = await entry.async('string');
        content = content.slice(0, remaining);
        textParts.push('\n===== ' + name + ' =====\n' + content);
        totalChars += content.length;
      } catch (_) {
        // Skip binary/corrupt entries instead of failing the whole ZIP.
      }
    }

    var summary = [
      'ZIP: ' + file.name,
      'Tổng entry: ' + names.length,
      'Đã đọc file text/code: ' + textParts.length,
      ''
    ].join('\n') + textParts.join('\n');

    return {
      name: file.name,
      kind: 'archive',
      mediaType: 'application/zip',
      textContent: trimAttachmentText(summary)
    };
  }

  async function readAttachment(file) {
    var lowerName = String(file.name || '').toLowerCase();
    var isImage = file.type.indexOf('image/') === 0;
    var isZip = file.type === 'application/zip' || /\.zip$/i.test(lowerName);

    if (isImage) {
      return await new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () {
          resolve({
            name: file.name,
            kind: 'image',
            mediaType: file.type,
            dataUrl: reader.result
          });
        };
        reader.onerror = function () {
          resolve({
            name: file.name,
            kind: 'file',
            mediaType: file.type || 'application/octet-stream'
          });
        };
        reader.readAsDataURL(file);
      });
    }

    if (isZip) {
      return await readZipFile(file);
    }

    if (TEXT_FILE_EXTENSIONS.test(lowerName) || /^text\//i.test(file.type)) {
      return await readTextFile(file);
    }

    return {
      name: file.name,
      kind: 'file',
      mediaType: file.type || 'application/octet-stream',
      size: file.size || 0
    };
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', function () {
      fileInput.click();
    });

    fileInput.addEventListener('change', async function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      fileInput.value = '';

      if (!files.length) return;

      if (streamStatus) streamStatus.textContent = 'Đang đọc tệp…';

      for (var i = 0; i < files.length; i++) {
        try {
          var attachment = await readAttachment(files[i]);
          pendingAttachments.push(attachment);
        } catch (error) {
          if (streamStatus) {
            streamStatus.textContent =
              'Không đọc được ' + files[i].name + ': ' +
              (error && error.message ? error.message : error);
          }
        }
      }

      renderAttachPreview();
      if (streamStatus) streamStatus.textContent = '';
    });
  }

  // ---------------------------------------------------------------------
  // Send flow
  // ---------------------------------------------------------------------
  chatForm.addEventListener(
    'submit',
    function (e) {
      e.preventDefault();

      var text =
        chatInput.value.trim();

      if (
        !text &&
        !pendingAttachments.length
      ) {
        return;
      }

      var convBeforeReply = getActiveConv();

      addMessage(
        'user',
        text,
        pendingAttachments.slice()
      );

      syncRouteForConversation(convBeforeReply, false);

      pendingAttachments = [];

      renderAttachPreview();

      chatInput.value = '';
      chatInput.style.height = 'auto';

      if (charCount) {
        charCount.textContent =
          '0 ký tự';
      }

      triggerAssistantResponse();
    }
  );

  chatInput.addEventListener(
    'input',
    function () {
      chatInput.style.height = 'auto';

      chatInput.style.height =
        Math.min(
          chatInput.scrollHeight,
          140
        ) + 'px';

      if (charCount) {
        charCount.textContent =
          chatInput.value.length +
          ' ký tự';
      }
    }
  );

  chatInput.addEventListener(
    'keydown',
    function (e) {
      if (
        e.key === 'Enter' &&
        !e.shiftKey
      ) {
        e.preventDefault();
        chatForm.requestSubmit();
      }
    }
  );

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  window.addEventListener('popstate', function () {
    var slug = routeSlug();

    if (slug) {
      var conv = conversations.find(function (item) {
        return item.slug === slug;
      });

      if (conv) {
        activeId = conv.id;
        persistActiveId();
        renderSidebar();
        renderMessages();
        return;
      }
    }

    if (isNewRoute()) {
      var fresh = makeNewConversation();
      uniqueConversationSlug(fresh);
      conversations.unshift(fresh);
      activeId = fresh.id;
      persistActiveId();
      renderSidebar();
      renderMessages();
    }
  });

  persistConversations();
  persistActiveId();
  if (!isNewRoute() && !requestedSlug) {
    syncRouteForConversation(getActiveConv(), true);
  }

  renderSidebar();
  renderMessages();

  window.addEventListener(
    'legendary:auth-changed',
    syncEngineModelAccess
  );
})();
