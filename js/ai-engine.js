(function () {
  'use strict';

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function invokeWithRetry(payload, token) {
    var lastError = null;
    var requestSignal = payload && payload.signal ? payload.signal : undefined;
    var timeoutId = null;
    var timeoutController = null;

    if (!requestSignal) {
      timeoutController = new AbortController();
      timeoutId = setTimeout(function () { timeoutController.abort(); }, 18000);
      requestSignal = timeoutController.signal;
    }

    var requestBody = Object.assign({}, payload);
    delete requestBody.signal;
    var config = window.LEGENDARY_SUPABASE_CONFIG || {};
    var baseUrl = String(config.url || '').replace(/\/$/, '');
    var anonKey = String(config.anonKey || '');

    if (!baseUrl || !anonKey) return { error: new Error('Supabase client chưa được cấu hình.') };

    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var response = await fetch(baseUrl + '/functions/v1/ai-chat-v10', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': anonKey,
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify(requestBody),
          signal: requestSignal
        });

        var raw = await response.text();
        var data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }

        if (response.ok) {
          if (timeoutId) clearTimeout(timeoutId);
          return { data: data };
        }

        var serverMessage = (data && (data.error || data.message || data.msg)) || raw.slice(0, 800) || ('HTTP ' + response.status);
        lastError = new Error('Edge Function HTTP ' + response.status + ': ' + serverMessage);

        if (response.status === 429) {
          var retryAfter = response.headers.get('Retry-After');
          if (data && data.retryAfter != null) retryAfter = String(data.retryAfter);
          lastError.retryAfter = retryAfter ? Number(retryAfter) : null;
          return { error: lastError, data: data };
        }

        if (response.status !== 408 && (response.status < 500 || response.status >= 600)) {
          return { error: lastError, data: data };
        }
      } catch (error) {
        lastError = error;
        if (error && error.name === 'AbortError') return { error: error };
      }

      if (attempt === 0) await sleep(250);
    }

    if (timeoutId) clearTimeout(timeoutId);
    return { error: lastError || new Error('Không thể gọi Legendary Engine.') };
  }

  function getFunctionError(result) {
    if (!result || !result.error) return null;
    var error = result.error;
    var status = error.context && error.context.status ? error.context.status : '';
    var message = result.data && result.data.error ? result.data.error : error.message;
    if (message && status) return 'HTTP ' + status + ': ' + message;
    return message || 'Không thể kết nối tới Edge Function ai-chat-v10.';
  }

  window.LegendaryAIEngine = {
    async image(options) {
      options = options || {};
      var token = await window.LegendaryBackend.getAccessToken();
      if (!token) throw new Error('Bạn cần đăng nhập để tạo ảnh.');

      var config = window.LEGENDARY_SUPABASE_CONFIG || {};
      var baseUrl = String(config.url || '').replace(/\/$/, '');
      var anonKey = String(config.anonKey || '');
      if (!baseUrl || !anonKey) throw new Error('Supabase client chưa được cấu hình.');

      var response = await fetch(baseUrl + '/functions/v1/image-generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          prompt: String(options.prompt || '').trim(),
          size: options.size || 'auto',
          quality: options.quality || 'auto',
          background: options.background || 'auto'
        }),
        signal: options.signal || undefined
      });

      var raw = await response.text();
      var data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }
      if (!response.ok) {
        throw new Error((data && (data.error || data.message)) || raw.slice(0, 800) || ('HTTP ' + response.status));
      }
      if (!data || !data.imageDataUrl) throw new Error('Image Provider đã phản hồi nhưng không có ảnh.');
      return data;
    },

    async chat(options) {
      options = options || {};
      var token = await window.LegendaryBackend.getAccessToken();
      if (!token) throw new Error('Bạn cần đăng nhập để dùng Legendary Engine.');

      var payload = {
        model: options.model || 'auto',
        messages: options.messages || [],
        system: options.system || '',
        temperature: options.temperature ?? 0.35,
        max_tokens: options.max_tokens || 8192,
        tool: options.tool || '',
        signal: options.signal || null
      };

      var result = await invokeWithRetry(payload, token);
      if (result.error) throw new Error(getFunctionError(result) || 'Failed to send a request to the Edge Function.');
      if (!result.data || !result.data.text) throw new Error('Edge Function đã phản hồi nhưng không có nội dung AI.');
      return result.data;
    }
  };
})();
