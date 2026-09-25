(function () {
  'use strict';

  var sb = window.LegendaryBackend && window.LegendaryBackend.client;
  if (!sb) return;

  window.LegendaryAIEngine = {
    async chat(options) {
      options = options || {};
      var token = await window.LegendaryBackend.getAccessToken();
      if (!token) throw new Error('Bạn cần đăng nhập để dùng Legendary Engine.');

      var result = await sb.functions.invoke('ai-chat', {
        body: {
          model: options.model || 'legendary-6',
          messages: options.messages || [],
          system: options.system || '',
          temperature: options.temperature ?? 0.35,
          max_tokens: options.max_tokens || 4096
        },
        headers: { Authorization: 'Bearer ' + token }
      });

      if (result.error) {
        var msg = result.data && result.data.error ? result.data.error : result.error.message;
        throw new Error(msg || 'AI gateway error');
      }
      if (!result.data || !result.data.text) {
        throw new Error('AI gateway returned no text.');
      }
      return result.data;
    }
  };
})();