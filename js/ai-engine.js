(function () {
  'use strict';

  var CHAT_PAYLOAD_BUDGET = 250000;
  var DEFAULT_MAX_TOKENS = 4096;

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function engineError(code, message, cause) {
    var error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function normalizeServerError(status, data, raw) {
    var serverCode = data && (data.code || data.error_code);
    var serverMessage = (data && (data.error || data.message || data.msg)) || raw.slice(0, 800);

    if (status === 401 || status === 403) {
      return engineError('AUTH_REQUIRED', serverMessage || 'Phiên đăng nhập không hợp lệ. Hãy đăng nhập lại.');
    }
    if (status === 408 || status === 504) {
      return engineError('TIMEOUT', serverMessage || 'AI phản hồi quá lâu. Hãy thử lại.');
    }
    if (status === 413) {
      return engineError('PAYLOAD_TOO_LARGE', serverMessage || 'Nội dung gửi lên quá lớn. Hãy rút gọn cuộc trò chuyện hoặc tệp đính kèm.');
    }
    if (status === 429) {
      return engineError('RATE_LIMITED', serverMessage || 'Bạn đang gửi quá nhanh hoặc đã chạm giới hạn. Hãy thử lại sau.');
    }
    if (serverCode === 'MODEL_UNAVAILABLE') {
      return engineError('MODEL_UNAVAILABLE', serverMessage || 'Model hiện không khả dụng.');
    }
    if (status >= 500) {
      return engineError('ENGINE_UNAVAILABLE', serverMessage || 'Legendary Engine hiện không khả dụng.');
    }
    return engineError(serverCode || 'ENGINE_ERROR', serverMessage || ('HTTP ' + status));
  }

  async function ensureAuthSession() {
    if (!window.LegendaryBackend || !window.LegendaryBackend.client) {
      throw engineError('SUPABASE_NOT_READY', 'Supabase chưa sẵn sàng.');
    }
    var token = await window.LegendaryBackend.getAccessToken();
    if (token) return token;

    throw engineError('AUTH_REQUIRED', 'Bạn đang ở chế độ khách. Hãy Đăng nhập hoặc Đăng ký để sử dụng Legendary Engine.');
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
      return { error: engineError('SUPABASE_NOT_CONFIGURED', 'Supabase client chưa được cấu hình.') };
    }

    var serialized;
    try {
      serialized = JSON.stringify(requestBody);
    } catch (error) {
      return { error: engineError('PAYLOAD_INVALID', 'Không thể chuẩn bị dữ liệu cuộc trò chuyện.', error) };
    }

    if (serialized.length > CHAT_PAYLOAD_BUDGET) {
      return {
        error: engineError(
          'PAYLOAD_TOO_LARGE',
          'Nội dung gửi lên quá lớn (' + Math.round(serialized.length / 1024) + ' KB). Hãy rút gọn lịch sử hoặc tệp đính kèm.'
        )
      };
    }

    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var response = await fetch(baseUrl + '/functions/v1/ai-chat-v10', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: 'Bearer ' + token
          },
          body: serialized,
          signal: requestSignal
        });
        var raw = await response.text();
        var data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (_) {}

        if (response.ok) return { data: data };

        lastError = normalizeServerError(response.status, data, raw);
        if (response.status !== 408 && response.status !== 429 && response.status < 500) {
          return { error: lastError, data: data };
        }
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        lastError = error && error.code ? error : engineError('NETWORK_ERROR', 'Không thể kết nối Legendary Engine.', error);
      }
      if (attempt === 0) await sleep(250);
    }

    return { error: lastError || engineError('ENGINE_UNAVAILABLE', 'Không thể gọi Legendary Engine.') };
  }

  window.LegendaryAIEngine = {
    async image(options) {
      options = options || {};
      var token = await ensureAuthSession();
      if (!token) throw engineError('AUTH_REQUIRED', 'Supabase chưa sẵn sàng.');
      var prompt = String(options.prompt || '').trim();
      if (!prompt) throw engineError('IMAGE_PROMPT_EMPTY', 'Prompt tạo ảnh không được để trống.');

      var config = window.LEGENDARY_SUPABASE_CONFIG || {};
      var baseUrl = String(config.url || '').replace(/\/$/, '');
      var anonKey = String(config.anonKey || '');
      if (!baseUrl || !anonKey) throw engineError('SUPABASE_NOT_CONFIGURED', 'Supabase client chưa được cấu hình.');

      var response = await fetch(baseUrl + '/functions/v1/image-generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: 'Bearer ' + token
        },
        body: JSON.stringify({
          prompt: prompt,
          size: options.size || 'auto',
          quality: options.quality || 'auto',
          background: options.background || 'auto'
        }),
        signal: options.signal || undefined
      });
      var raw = await response.text();
      var data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
      if (!response.ok) throw normalizeServerError(response.status, data, raw);
      if (!data || !data.imageDataUrl) throw engineError('IMAGE_EMPTY', 'Image Provider không trả về ảnh.');
      return data;
    },

    async chat(options) {
      options = options || {};
      var token = await ensureAuthSession();
      if (!token) throw engineError('AUTH_REQUIRED', 'Supabase chưa sẵn sàng.');
      if (!options.messages || !options.messages.length) {
        throw engineError('EMPTY_MESSAGES', 'Không có nội dung để gửi — hãy nhập tin nhắn trước khi gửi.');
      }

      var payload = {
        model: options.model || 'auto',
        messages: options.messages || [],
        system: options.system || '',
        temperature: options.temperature ?? 0.35,
        max_tokens: options.max_tokens || DEFAULT_MAX_TOKENS,
        tool: options.tool || '',
        reasoning: !!options.reasoning,
        reasoningTier: options.reasoningTier || 'none',
        analysis_level: options.analysisLevel || 0,
        mode: options.mode || 'general',
        capability: options.capability || '',
        cacheKey: options.cacheKey || '',
        signal: options.signal || null
      };

      var result = await invokeWithRetry(payload, token);
      if (result.error) throw result.error;
      if (!result.data || !result.data.text) {
        throw engineError('EMPTY_ENGINE_RESPONSE', 'Edge Function đã phản hồi nhưng không có nội dung AI.');
      }
      return result.data;
    }
  };
})();
