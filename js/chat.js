(function () {
  var chatApp = document.getElementById('chatApp');
  var chatSidebar = document.getElementById('chatSidebar');
  var sidebarToggle = document.getElementById('sidebarToggle');
  var newChatBtn = document.getElementById('newChatBtn');
  var convList = document.getElementById('convList');
  var expandChatBtn = document.getElementById('expandChatBtn');

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

  var SETTINGS_KEY = 'legendaryai_settings';
  var CONV_KEY = 'legendaryai_conversations_v2';
  var ACTIVE_KEY = 'legendaryai_active_conv_v2';
  var activeController = null;
  var pendingAttachments = [];

  var DEFAULT_ENDPOINTS = {
    anthropic: 'https://api.anthropic.com/v1/messages',
    openai: 'https://api.openai.com/v1/chat/completions'
  };
  var DEFAULT_MODELS = {
    anthropic: 'claude-sonnet-5',
    openai: 'gpt-4o-mini'
  };

  // ---------------------------------------------------------------------
  // Settings (global, shared across conversations)
  // ---------------------------------------------------------------------
  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return Object.assign({
        mode: 'demo',
        engineModel: 'legendary-6',
        provider: 'anthropic',
        endpoint: '',
        key: '',
        model: DEFAULT_MODELS.anthropic,
        system: '',
        stream: true
      }, parsed || {});
    } catch (e) {
      return { mode: 'demo', engineModel: 'legendary-6', provider: 'anthropic', endpoint: '', key: '', model: DEFAULT_MODELS.anthropic, system: '', stream: true };
    }
  }
  function saveSettingsToStorage(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  var settings = loadSettings();
  applySettingsToForm();
  updateModeLabel();

  function applySettingsToForm() {
    modeSelect.value = settings.mode || 'demo';
    if (engineModelSelect) engineModelSelect.value = settings.engineModel || 'legendary-6';
    providerSelect.value = settings.provider || 'anthropic';
    apiEndpoint.value = settings.endpoint || DEFAULT_ENDPOINTS[settings.provider || 'anthropic'];
    apiKey.value = settings.key || '';
    apiModel.value = settings.model || DEFAULT_MODELS[settings.provider || 'anthropic'];
    systemPrompt.value = settings.system || '';
    streamToggle.checked = settings.stream !== false;
  }

  function updateModeLabel() {
    var live = settings.mode === 'live';
    chatModeLabel.textContent = live ? 'Chế độ AI thật (' + (settings.provider === 'openai' ? 'OpenAI-compatible' : 'Anthropic-compatible') + ')' : 'Chế độ mô phỏng';
    if (chatDot) chatDot.classList.toggle('live', live);
  }

  providerSelect.addEventListener('change', function () {
    var p = providerSelect.value;
    if (!apiEndpoint.value || apiEndpoint.value === DEFAULT_ENDPOINTS.anthropic || apiEndpoint.value === DEFAULT_ENDPOINTS.openai) {
      apiEndpoint.value = DEFAULT_ENDPOINTS[p];
    }
    if (!apiModel.value || apiModel.value === DEFAULT_MODELS.anthropic || apiModel.value === DEFAULT_MODELS.openai) {
      apiModel.value = DEFAULT_MODELS[p];
    }
  });

  settingsBtn.addEventListener('click', function () {
    settingsBackdrop.classList.add('open');
  });
  closeSettings.addEventListener('click', function () {
    settingsBackdrop.classList.remove('open');
  });
  settingsBackdrop.addEventListener('click', function (e) {
    if (e.target === settingsBackdrop) settingsBackdrop.classList.remove('open');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      settingsBackdrop.classList.remove('open');
      if (chatApp.classList.contains('chat-app--full')) {
        chatApp.classList.remove('chat-app--full');
        document.body.classList.remove('chat-fullscreen-active');
        if (expandChatBtn) expandChatBtn.textContent = '⤢';
      }
    }
  });
  saveSettings.addEventListener('click', function () {
    settings = {
      mode: modeSelect.value,
      engineModel: engineModelSelect ? engineModelSelect.value : 'legendary-6',
      provider: providerSelect.value,
      endpoint: apiEndpoint.value.trim() || DEFAULT_ENDPOINTS[providerSelect.value],
      key: apiKey.value.trim(),
      model: apiModel.value.trim() || DEFAULT_MODELS[providerSelect.value],
      system: systemPrompt.value.trim(),
      stream: streamToggle.checked
    };
    saveSettingsToStorage(settings);
    updateModeLabel();
    settingsBackdrop.classList.remove('open');
  });

  // ---------------------------------------------------------------------
  // Conversations (multi-thread, persisted per browser)
  // ---------------------------------------------------------------------
  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function makeNewConversation() {
    return {
      id: uid(),
      title: 'Cuộc trò chuyện mới',
      createdAt: Date.now(),
      messages: [
        { role: 'ai', text: 'Xin chào, tôi là Legendary AI. Bạn muốn bắt đầu với điều gì hôm nay?', attachments: [] }
      ]
    };
  }

  function loadConversations() {
    try {
      var raw = localStorage.getItem(CONV_KEY);
      var list = raw ? JSON.parse(raw) : null;
      if (Array.isArray(list) && list.length) return list;
    } catch (e) { /* ignore */ }
    return [makeNewConversation()];
  }

  var conversations = loadConversations();
  var activeId = null;
  try { activeId = localStorage.getItem(ACTIVE_KEY); } catch (e) { /* ignore */ }
  if (!activeId || !findConv(activeId)) activeId = conversations[0].id;

  function persistConversations() {
    try { localStorage.setItem(CONV_KEY, JSON.stringify(conversations)); } catch (e) { /* ignore */ }
  }
  function persistActiveId() {
    try { localStorage.setItem(ACTIVE_KEY, activeId); } catch (e) { /* ignore */ }
  }

  function findConv(id) {
    for (var i = 0; i < conversations.length; i++) {
      if (conversations[i].id === id) return conversations[i];
    }
    return null;
  }
  function getActiveConv() {
    return findConv(activeId) || conversations[0];
  }

  function autoTitle(conv, text, attachments) {
    if (conv.title !== 'Cuộc trò chuyện mới') return;
    var t = (text || '').trim();
    if (!t && attachments && attachments.length) t = attachments[0].name;
    if (!t) return;
    conv.title = t.length > 42 ? t.slice(0, 42) + '…' : t;
  }

  function newConversation() {
    var conv = makeNewConversation();
    conversations.unshift(conv);
    activeId = conv.id;
    persistConversations();
    persistActiveId();
    renderSidebar();
    renderMessages();
    closeSidebarMobile();
    chatInput.focus();
  }

  function switchConversation(id) {
    if (id === activeId) { closeSidebarMobile(); return; }
    activeId = id;
    persistActiveId();
    renderSidebar();
    renderMessages();
    closeSidebarMobile();
  }

  function deleteConversation(id) {
    var idx = -1;
    for (var i = 0; i < conversations.length; i++) { if (conversations[i].id === id) { idx = i; break; } }
    if (idx === -1) return;
    if (!window.confirm('Xoá hội thoại này? Không thể hoàn tác.')) return;
    conversations.splice(idx, 1);
    if (!conversations.length) conversations.push(makeNewConversation());
    if (activeId === id) activeId = conversations[0].id;
    persistConversations();
    persistActiveId();
    renderSidebar();
    renderMessages();
  }

  function renameConversationTitle(id, newTitle) {
    var conv = findConv(id);
    if (!conv) return;
    conv.title = (newTitle || '').trim().slice(0, 60) || 'Cuộc trò chuyện mới';
    persistConversations();
    renderSidebar();
  }

  function closeSidebarMobile() {
    chatApp.classList.remove('sidebar-open');
    if (sidebarToggle) sidebarToggle.setAttribute('aria-expanded', 'false');
  }

  function renderSidebar() {
    if (!convList) return;
    convList.innerHTML = '';
    var sorted = conversations.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    sorted.forEach(function (conv) {
      var item = document.createElement('div');
      item.className = 'conv-item' + (conv.id === activeId ? ' active' : '');

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
          if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
          if (ev.key === 'Escape') { committed = true; renderSidebar(); }
        });
      });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'conv-del';
      del.title = 'Xoá hội thoại';
      del.setAttribute('aria-label', 'Xoá hội thoại "' + conv.title + '"');
      del.textContent = '✕';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteConversation(conv.id);
      });

      item.appendChild(title);
      item.appendChild(del);
      item.addEventListener('click', function () { switchConversation(conv.id); });
      convList.appendChild(item);
    });
  }

  if (newChatBtn) newChatBtn.addEventListener('click', newConversation);
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function () {
      var open = chatApp.classList.toggle('sidebar-open');
      sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  if (expandChatBtn) {
    expandChatBtn.addEventListener('click', function () {
      var full = chatApp.classList.toggle('chat-app--full');
      document.body.classList.toggle('chat-fullscreen-active', full);
      expandChatBtn.textContent = full ? '⤡' : '⤢';
      expandChatBtn.title = full ? 'Thu nhỏ' : 'Phóng to toàn màn hình';
      chatWindow.scrollTop = chatWindow.scrollHeight;
    });
  }

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
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  }

  function splitTableRow(line) {
    var parts = line.split('|').map(function (c) { return c.trim(); });
    if (parts.length && parts[0] === '') parts.shift();
    if (parts.length && parts[parts.length - 1] === '') parts.pop();
    return parts;
  }

  function renderMarkdown(raw) {
    if (!raw) return '<p></p>';
    var codeBlocks = [];
    var text = raw.replace(/```([a-zA-Z0-9+#_-]*)\n?([\s\S]*?)```/g, function (m, lang, code) {
      var idx = codeBlocks.length;
      codeBlocks.push({ lang: (lang || '').trim(), code: code.replace(/\n$/, '') });
      return '\u0000CODEBLOCK' + idx + '\u0000';
    });

    var lines = text.split('\n');
    var html = '';
    var paraBuf = [];

    function flushPara() {
      if (!paraBuf.length) return;
      html += '<p>' + inlineFormat(escapeHtml(paraBuf.join('\n'))).replace(/\n/g, '<br>') + '</p>';
      paraBuf = [];
    }

    var i = 0;
    while (i < lines.length) {
      var line = lines[i];

      var codeMatch = line.match(/^\u0000CODEBLOCK(\d+)\u0000$/);
      if (codeMatch) {
        flushPara();
        var block = codeBlocks[parseInt(codeMatch[1], 10)];
        var langLabel = block.lang || 'text';
        var langClass = block.lang ? ' class="language-' + block.lang.replace(/[^a-zA-Z0-9]/g, '') + '"' : '';
        html += '<div class="code-block"><div class="code-block-head"><span>' + escapeHtml(langLabel) +
          '</span><button type="button" class="code-copy">Sao chép</button></div><pre><code' + langClass + '>' +
          escapeHtml(block.code) + '</code></pre></div>';
        i++; continue;
      }

      if (/^\s*$/.test(line)) { flushPara(); i++; continue; }

      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushPara();
        var level = h[1].length;
        html += '<h' + level + '>' + inlineFormat(escapeHtml(h[2])) + '</h' + level + '>';
        i++; continue;
      }

      if (/^\s*>\s?/.test(line)) {
        flushPara();
        var quoteLines = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        html += '<blockquote>' + inlineFormat(escapeHtml(quoteLines.join('\n'))).replace(/\n/g, '<br>') + '</blockquote>';
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        flushPara();
        var items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
          i++;
        }
        html += '<ul>' + items.map(function (it) { return '<li>' + inlineFormat(escapeHtml(it)) + '</li>'; }).join('') + '</ul>';
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        flushPara();
        var oitems = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          oitems.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        html += '<ol>' + oitems.map(function (it) { return '<li>' + inlineFormat(escapeHtml(it)) + '</li>'; }).join('') + '</ol>';
        continue;
      }

      if (line.indexOf('|') !== -1 && lines[i + 1] && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flushPara();
        var headerCells = splitTableRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim() !== '') {
          rows.push(splitTableRow(lines[i]));
          i++;
        }
        html += '<table><thead><tr>' + headerCells.map(function (c) { return '<th>' + inlineFormat(escapeHtml(c)) + '</th>'; }).join('') +
          '</tr></thead><tbody>' + rows.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + inlineFormat(escapeHtml(c)) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table>';
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
      try { window.hljs.highlightElement(nodes[i]); } catch (e) { /* ignore */ }
    }
  }

  // Copy code-block contents via delegated click handler.
  chatWindow.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.code-copy');
    if (!btn) return;
    var block = btn.closest('.code-block');
    var codeEl = block && block.querySelector('code');
    if (!codeEl || !navigator.clipboard) return;
    navigator.clipboard.writeText(codeEl.textContent).then(function () {
      var prev = btn.textContent;
      btn.textContent = 'Đã chép ✓';
      setTimeout(function () { btn.textContent = prev; }, 1200);
    }).catch(function () { /* ignore */ });
  });

  // ---------------------------------------------------------------------
  // Message rendering
  // ---------------------------------------------------------------------
  function attachmentsHtml(attachments) {
    if (!attachments || !attachments.length) return '';
    var html = '<div class="msg-attachments">';
    attachments.forEach(function (a) {
      if (a.kind === 'image') {
        html += '<img class="att-thumb" src="' + a.dataUrl + '" alt="' + escapeHtml(a.name) + '">';
      } else {
        html += '<span class="att-file">📄 ' + escapeHtml(a.name) + '</span>';
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
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = '✓';
          setTimeout(function () { copyBtn.textContent = '⧉'; }, 1200);
        }).catch(function () { /* ignore */ });
      }
    });
    actions.appendChild(copyBtn);
    if (isLast) {
      var regenBtn = document.createElement('button');
      regenBtn.type = 'button';
      regenBtn.title = 'Tạo lại phản hồi';
      regenBtn.setAttribute('aria-label', 'Tạo lại phản hồi');
      regenBtn.setAttribute('data-regen', '1');
      regenBtn.textContent = '🔁';
      regenBtn.addEventListener('click', regenerateLast);
      actions.appendChild(regenBtn);
    }
    wrap.appendChild(actions);
  }

  function renderMessageDom(role, text, attachments, isLast) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-ai');
    wrap.style.position = 'relative';
    var avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'user' ? 'B' : 'L';
    var bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    var attHtml = attachmentsHtml(attachments);
    if (role === 'user') {
      bubble.innerHTML = attHtml + (text ? '<p>' + escapeHtml(text) + '</p>' : '');
    } else {
      bubble.innerHTML = attHtml + renderMarkdown(text || '');
      enhanceCodeBlocks(bubble);
    }
    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    chatWindow.appendChild(wrap);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    if (role !== 'user' && text) attachMsgActions(wrap, text, !!isLast);
    return { wrap: wrap, bubble: bubble };
  }

  function renderMessages() {
    chatWindow.innerHTML = '';
    var conv = getActiveConv();
    var lastAiIdx = -1;
    conv.messages.forEach(function (m, idx) { if (m.role === 'ai') lastAiIdx = idx; });
    conv.messages.forEach(function (m, idx) {
      renderMessageDom(m.role, m.text, m.attachments, idx === lastAiIdx);
    });
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function addMessage(role, text, attachments) {
    var conv = getActiveConv();
    var atts = attachments || [];
    conv.messages.push({ role: role, text: text, attachments: atts });
    if (role === 'user') autoTitle(conv, text, atts);
    persistConversations();
    renderSidebar();
    return renderMessageDom(role, text, atts, false);
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
    return { wrap: wrap, bubble: bubble, raw: '', convId: activeId };
  }

  function finalizeAiBubble(state) {
    state.bubble.classList.remove('typing');
    if (!state.raw) {
      state.bubble.textContent = 'Không nhận được phản hồi hợp lệ từ API.';
      state.bubble.classList.add('error');
      return;
    }
    state.bubble.innerHTML = renderMarkdown(state.raw);
    enhanceCodeBlocks(state.bubble);
    var conv = findConv(state.convId) || getActiveConv();
    conv.messages.push({ role: 'ai', text: state.raw, attachments: [] });
    persistConversations();
    if (conv.id === activeId) {
      var oldRegen = chatWindow.querySelector('.msg-actions button[data-regen]');
      if (oldRegen) oldRegen.remove();
      attachMsgActions(state.wrap, state.raw, true);
    }
  }

  function setErrorBubble(state, message) {
    state.bubble.classList.remove('typing');
    state.bubble.classList.add('error');
    state.bubble.textContent = message;
  }

  function getLastUserMessageText(conv) {
    for (var i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].role === 'user') return conv.messages[i].text;
    }
    return '';
  }

  function regenerateLast() {
    if (sendBtn.disabled) return;
    var conv = getActiveConv();
    var idx = conv.messages.length - 1;
    if (idx < 0 || conv.messages[idx].role !== 'ai') return;
    conv.messages.splice(idx, 1);
    persistConversations();
    var lastWrap = chatWindow.querySelector('.msg:last-child');
    if (lastWrap) lastWrap.remove();
    triggerAssistantResponse();
  }

  // ---------------------------------------------------------------------
  // Demo mode: canned, topic-aware replies (no network calls)
  // ---------------------------------------------------------------------
  var demoReplies = [
    { match: /(mã|code|lập trình|debug)/i, reply: 'Ở chế độ mô phỏng mình chưa thể chạy mã thật, nhưng ở chế độ AI thật, Legendary AI có thể đọc lỗi, đề xuất sửa và viết lại hàm cho bạn theo ngôn ngữ bạn đang dùng.\n\n```js\nfunction vidu(a, b) {\n  return a + b;\n}\n```' },
    { match: /(tài liệu|báo cáo|hợp đồng|viết|email)/i, reply: 'Legendary AI có thể soạn thảo tài liệu hoàn chỉnh theo đúng giọng văn và cấu trúc bạn cần — chỉ cần mô tả mục đích, đối tượng đọc và độ dài mong muốn.' },
    { match: /(tìm kiếm|tra cứu|thông tin mới)/i, reply: 'Ở chế độ AI thật, Legendary AI tra cứu thông tin cập nhật và tổng hợp lại kèm nguồn tham khảo rõ ràng.' },
    { match: /(token|giá|gói|pricing|so sánh)/i, reply: 'Gói Legendary cấp hạn mức tối đa **1.000.000 token mỗi ngày**. Bạn có thể xem chi tiết các gói ở phần "Chọn gói phù hợp" phía dưới, hoặc bảng so sánh ở phần "So sánh".' },
    { match: /(xin chào|hello|hi|chào)/i, reply: 'Chào bạn! Mình là Legendary AI. Bạn có thể hỏi mình về lập trình, viết tài liệu, tìm kiếm thông tin hoặc bất cứ điều gì bạn đang làm.' }
  ];

  function getDemoReply(userText) {
    for (var i = 0; i < demoReplies.length; i++) {
      if (demoReplies[i].match.test(userText || '')) return demoReplies[i].reply;
    }
    return 'Đây là bản demo chạy ở chế độ mô phỏng nên câu trả lời được dựng sẵn. Mở "⚙ Cài đặt" và bật "Gọi API thật" với key của riêng bạn để trò chuyện với mô hình AI thật, có streaming theo thời gian thực, nhiều hội thoại và đính kèm ảnh/tệp.';
  }

  // ---------------------------------------------------------------------
  // Live mode: direct call to an Anthropic- or OpenAI-compatible endpoint
  // ---------------------------------------------------------------------
  function buildMessageContent(m, provider) {
    var textPart = m.text || '';
    var atts = m.attachments || [];
    var textAttachments = atts.filter(function (a) { return a.kind === 'text'; });
    var imageAttachments = atts.filter(function (a) { return a.kind === 'image'; });
    var composed = textPart;
    textAttachments.forEach(function (a) {
      composed += '\n\n--- Tệp đính kèm: ' + a.name + ' ---\n' + (a.textContent || '');
    });
    if (!imageAttachments.length) return composed || ' ';
    var blocks = imageAttachments.map(function (a) {
      if (provider === 'openai') return { type: 'image_url', image_url: { url: a.dataUrl } };
      return { type: 'image', source: { type: 'base64', media_type: a.mediaType || 'image/png', data: (a.dataUrl.split(',')[1] || '') } };
    });
    blocks.push({ type: 'text', text: composed || ' ' });
    return blocks;
  }

  function buildRequestBody(provider, conv) {
    var messages = conv.messages.map(function (m) {
      return { role: m.role === 'ai' ? 'assistant' : 'user', content: buildMessageContent(m, provider) };
    });
    if (provider === 'openai') {
      var oaMessages = messages.slice();
      if (settings.system) oaMessages.unshift({ role: 'system', content: settings.system });
      return { model: settings.model, max_tokens: 1024, stream: !!settings.stream, messages: oaMessages };
    }
    var body = { model: settings.model, max_tokens: 1024, stream: !!settings.stream, messages: messages };
    if (settings.system) body.system = settings.system;
    return body;
  }

  function buildHeaders(provider) {
    if (provider === 'openai') {
      return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.key };
    }
    return {
      'Content-Type': 'application/json',
      'x-api-key': settings.key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  }

  function extractNonStreamText(provider, data) {
    if (provider === 'openai') {
      if (data && data.choices && data.choices[0] && data.choices[0].message) {
        return (data.choices[0].message.content || '').trim();
      }
      return '';
    }
    if (data && data.content) {
      return data.content.map(function (b) { return b.text || ''; }).join('\n').trim();
    }
    return '';
  }

  function extractErrorMessage(data) {
    if (data && data.error) {
      return typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
    }
    return null;
  }

  function readStream(response, provider, onDelta, onDone, onError) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    function pump() {
      return reader.read().then(function (result) {
        if (result.done) { onDone(); return; }
        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(function (line) {
          line = line.trim();
          if (!line.startsWith('data:')) return;
          var payload = line.slice(5).trim();
          if (payload === '[DONE]') { onDone(); return; }
          var json;
          try { json = JSON.parse(payload); } catch (e) { return; }
          if (provider === 'openai') {
            var delta = json.choices && json.choices[0] && json.choices[0].delta;
            if (delta && delta.content) onDelta(delta.content);
          } else {
            if (json.type === 'content_block_delta' && json.delta && json.delta.text) onDelta(json.delta.text);
            if (json.type === 'error') onError(extractErrorMessage(json) || 'Lỗi luồng dữ liệu từ API.');
          }
        });
        return pump();
      });
    }
    return pump().catch(onError);
  }

  function callLiveAPI(conv) {
    var typing = addTypingBubble();
    var provider = settings.provider === 'openai' ? 'openai' : 'anthropic';
    var useStream = settings.stream !== false;

    activeController = new AbortController();
    toggleBusyUI(true);
    if (streamStatus) streamStatus.textContent = useStream ? 'Đang nhận phản hồi trực tiếp…' : 'Đang chờ phản hồi…';

    fetch(settings.endpoint, {
      method: 'POST',
      headers: buildHeaders(provider),
      body: JSON.stringify(buildRequestBody(provider, conv)),
      signal: activeController.signal
    })
      .then(function (res) {
        var contentType = res.headers.get('content-type') || '';
        if (useStream && contentType.indexOf('text/event-stream') !== -1 && res.body) {
          typing.bubble.classList.remove('typing');
          typing.bubble.textContent = '';
          return readStream(res, provider, function (delta) {
            typing.raw += delta;
            typing.bubble.textContent = typing.raw;
            chatWindow.scrollTop = chatWindow.scrollHeight;
          }, function () {
            finalizeAiBubble(typing);
            toggleBusyUI(false);
            if (streamStatus) streamStatus.textContent = '';
          }, function (err) {
            setErrorBubble(typing, 'Lỗi khi đọc luồng dữ liệu: ' + (err && err.message ? err.message : err));
            toggleBusyUI(false);
            if (streamStatus) streamStatus.textContent = '';
          });
        }
        return res.json().then(function (data) {
          var errMsg = extractErrorMessage(data);
          if (errMsg) {
            setErrorBubble(typing, 'Lỗi API: ' + errMsg);
          } else {
            typing.raw = extractNonStreamText(provider, data);
            finalizeAiBubble(typing);
          }
          toggleBusyUI(false);
          if (streamStatus) streamStatus.textContent = '';
        });
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') {
          setErrorBubble(typing, 'Đã dừng phản hồi.');
        } else {
          setErrorBubble(typing, 'Không thể kết nối tới API (có thể do CORS hoặc endpoint sai). Chi tiết: ' + (err && err.message ? err.message : err));
        }
        toggleBusyUI(false);
        if (streamStatus) streamStatus.textContent = '';
      });
  }

  
  function callLegendaryEngine(conv) {
    var typing = addTypingBubble();
    toggleBusyUI(true);
    if (streamStatus) streamStatus.textContent = 'Legendary Engine đang suy luận…';

    var messages = conv.messages.map(function (m) {
      return {
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: buildMessageContent(m, 'openai')
      };
    });

    window.LegendaryAIEngine.chat({
      model: settings.engineModel || 'legendary-6',
      messages: messages,
      system: settings.system || '',
      temperature: 0.35,
      max_tokens: 4096
    }).then(function (result) {
      typing.raw = result.text || '';
      finalizeAiBubble(typing);
      toggleBusyUI(false);
      if (streamStatus) streamStatus.textContent = '';
    }).catch(function (err) {
      setErrorBubble(typing, 'Legendary Engine: ' + (err && err.message ? err.message : err));
      toggleBusyUI(false);
      if (streamStatus) streamStatus.textContent = '';
    });
  }

  function triggerAssistantResponse() {
    var conv = getActiveConv();
    if (settings.mode === 'legendary' && window.LegendaryAIEngine) {
      callLegendaryEngine(conv);
      return;
    }
    if (settings.mode === 'live' && settings.key) {
      callLiveAPI(conv);
      return;
    }
    var lastUserText = getLastUserMessageText(conv);
    var typing = addTypingBubble();
    setTimeout(function () {
      typing.raw = getDemoReply(lastUserText);
      finalizeAiBubble(typing);
    }, 650 + Math.random() * 500);
  }

  function toggleBusyUI(busy) {
    sendBtn.disabled = busy;
    if (stopBtn) stopBtn.hidden = !busy;
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', function () {
      if (activeController) activeController.abort();
      toggleBusyUI(false);
    });
  }

  if (clearChatBtn) {
    clearChatBtn.addEventListener('click', function () {
      var conv = getActiveConv();
      conv.messages = [{ role: 'ai', text: 'Đã xoá hội thoại này. Bạn muốn bắt đầu với điều gì?', attachments: [] }];
      persistConversations();
      renderSidebar();
      renderMessages();
    });
  }

  if (suggestionsWrap) {
    suggestionsWrap.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-suggest]');
      if (!btn) return;
      chatInput.value = btn.getAttribute('data-suggest');
      chatInput.dispatchEvent(new Event('input'));
      chatForm.requestSubmit();
    });
  }

  // ---------------------------------------------------------------------
  // Attachments (images + text files)
  // ---------------------------------------------------------------------
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

  function readAttachment(file) {
    var isImage = file.type.indexOf('image/') === 0;
    var reader = new FileReader();
    reader.onload = function () {
      if (isImage) {
        pendingAttachments.push({ name: file.name, kind: 'image', mediaType: file.type, dataUrl: reader.result });
      } else {
        var content = String(reader.result || '');
        if (content.length > 6000) content = content.slice(0, 6000) + '\n… (đã cắt bớt, tệp quá dài)';
        pendingAttachments.push({ name: file.name, kind: 'text', mediaType: 'text/plain', textContent: content });
      }
      renderAttachPreview();
    };
    if (isImage) reader.readAsDataURL(file);
    else reader.readAsText(file);
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      files.forEach(readAttachment);
      fileInput.value = '';
    });
  }

  // ---------------------------------------------------------------------
  // Send flow
  // ---------------------------------------------------------------------
  chatForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = chatInput.value.trim();
    if (!text && !pendingAttachments.length) return;

    addMessage('user', text, pendingAttachments.slice());
    pendingAttachments = [];
    renderAttachPreview();

    chatInput.value = '';
    chatInput.style.height = 'auto';
    if (charCount) charCount.textContent = '0 ký tự';

    triggerAssistantResponse();
  });

  chatInput.addEventListener('input', function () {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
    if (charCount) charCount.textContent = chatInput.value.length + ' ký tự';
  });

  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  renderSidebar();
  renderMessages();
})();
