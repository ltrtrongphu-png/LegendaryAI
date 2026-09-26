(function () {
  'use strict';

  var sb = window.LegendaryBackend && window.LegendaryBackend.client;
  if (!sb) return;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function invokeWithRetry(payload, token) {
    var lastError = null;

    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var result = await sb.functions.invoke('ai-chat', {
          body: payload,
          headers: {
            Authorization: 'Bearer ' + token
          }
        });

        if (!result.error) {
          return result;
        }

        lastError = result.error;

        // Retry only transient gateway/network failures.
        var status = result.error.context && result.error.context.status;
        if (status && status !== 408 && status !== 429 && status < 500) {
          return result;
        }
      } catch (error) {
        lastError = error;
      }

      if (attempt === 0) {
        await sleep(120);
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
        max_tokens: options.max_tokens || 4096
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
