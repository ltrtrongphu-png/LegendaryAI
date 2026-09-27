(function () {
  'use strict';

  // Do not abort initialization when Supabase is still becoming available.
  // The engine resolves the current backend/token lazily when chat() is called.
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function invokeWithRetry(payload, token) {
    var lastError = null;
    var requestSignal = payload && payload.signal ? payload.signal : undefined;
    var requestBody = Object.assign({}, payload);
    delete requestBody.signal;
    var config = window.LEGENDARY_SUPABASE_CONFIG || {};
    var baseUrl = String(config.url || '').replace(/\/$/, '');
    var anonKey = String(config.anonKey || '');

    if (!baseUrl || !anonKey) {
      return { error: new Error('Supabase client chưa được cấu hình.') };
    }

    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        // Use a direct fetch here instead of supabase.functions.invoke().
        // This makes the Edge Function request explicit and avoids client-side
        // invoke wrapper failures while preserving Supabase JWT + CORS auth.
        var response = await fetch(baseUrl + '/functions/v1/ai-chat', {
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

        try {
          data = raw ? JSON.parse(raw) : null;
        } catch (_) {
          data = null;
        }

        if (response.ok) {
          return { data: data };
        }

        var serverMessage =
          (data && (data.error || data.message || data.msg)) ||
          raw.slice(0, 800) ||
          ('HTTP ' + response.status);

        lastError = new Error(
          'Edge Function HTTP ' + response.status + ': ' + serverMessage
        );

        // Do not retry authentication, permission, validation, or token-limit
        // failures. Retry only transient 408/429/5xx responses.
        if (
          response.status !== 408 &&
          response.status !== 429 &&
          response.status < 500
        ) {
          return { error: lastError, data: data };
        }
      } catch (error) {
        lastError = error;
      }

      if (attempt === 0) {
        await sleep(250);
      }
    }

    return {
      error: lastError || new Error('Không thể gọi Legendary Engine.')
    };
  }

  function getFunctionError(result) {
    if (!result || !result.error) return null;

    var error = result.error;
    var status =
      error.context && error.context.status
        ? error.context.status
        : '';

    var body = null;

    try {
      if (error.context && typeof error.context.json === 'function') {
        body = error.context.json();
      }
    } catch (e) {
      body = null;
    }

    var message =
      result.data && result.data.error
        ? result.data.error
        : error.message;

    if (message && status) {
      return 'HTTP ' + status + ': ' + message;
    }

    return message || 'Không thể kết nối tới Edge Function ai-chat.';
  }

  window.LegendaryAIEngine = {
    async chat(options) {
      options = options || {};

      var token = await window.LegendaryBackend.getAccessToken();

      if (!token) {
        throw new Error('Bạn cần đăng nhập để dùng Legendary Engine.');
      }

      var payload = {
        model: options.model || 'auto',
        messages: options.messages || [],
        system: options.system || '',
        temperature: options.temperature ?? 0.35,
        max_tokens: options.max_tokens || 4096,
        tool: options.tool || '',
        signal: options.signal || null
      };

      var result = await invokeWithRetry(payload, token);

      if (result.error) {
        throw new Error(
          getFunctionError(result) ||
          'Failed to send a request to the Edge Function.'
        );
      }

      if (!result.data || !result.data.text) {
        throw new Error(
          'Edge Function đã phản hồi nhưng không có nội dung AI.'
        );
      }

      return result.data;
    }
  };
})();
