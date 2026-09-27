(function () {
  'use strict';
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  async function ensureGuestSession() {
    if (!window.LegendaryBackend || !window.LegendaryBackend.client) return null;
    var token = await window.LegendaryBackend.getAccessToken();
    if (token) return token;
    var client = window.LegendaryBackend.client;
    if (!client.auth || !client.auth.signInAnonymously) return null;
    var r = await client.auth.signInAnonymously({ data: { source: 'legendary-web-guest' } });
    if (r.error) throw new Error('Không thể khởi tạo phiên khách: ' + r.error.message);
    window.dispatchEvent(new CustomEvent('legendary:guest-session-ready'));
    return r.data && r.data.session ? r.data.session.access_token : null;
  }
  async function invokeWithRetry(payload, token) {
    var lastError = null;
    var requestSignal = payload && payload.signal ? payload.signal : undefined;
    var requestBody = Object.assign({}, payload); delete requestBody.signal;
    var config = window.LEGENDARY_SUPABASE_CONFIG || {};
    var baseUrl = String(config.url || '').replace(/\/$/, '');
    var anonKey = String(config.anonKey || '');
    if (!baseUrl || !anonKey) return { error: new Error('Supabase client chưa được cấu hình.') };
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var response = await fetch(baseUrl + '/functions/v1/ai-chat-v10', { method:'POST', headers:{'Content-Type':'application/json',apikey:anonKey,Authorization:'Bearer '+token}, body:JSON.stringify(requestBody), signal:requestSignal });
        var raw = await response.text(); var data=null; try { data=raw?JSON.parse(raw):null; } catch (_) {}
        if (response.ok) return {data:data};
        var serverMessage=(data&&(data.error||data.message||data.msg))||raw.slice(0,800)||('HTTP '+response.status);
        lastError=new Error('Edge Function HTTP '+response.status+': '+serverMessage);
        if(response.status!==408&&response.status!==429&&response.status<500)return{error:lastError,data:data};
      } catch(error){lastError=error;}
      if(attempt===0)await sleep(250);
    }
    return {error:lastError||new Error('Không thể gọi Legendary Engine.')};
  }
  window.LegendaryAIEngine={
    async chat(options){
      options=options||{};
      var token=await ensureGuestSession();
      if(!token) throw new Error('Supabase chưa sẵn sàng.');
      if(!options.messages||!options.messages.length) throw new Error('Không có nội dung để gửi — hãy nhập tin nhắn trước khi gửi.');
      var payload={
        model:options.model||'auto', messages:options.messages||[], system:options.system||'',
        temperature:options.temperature??0.35, max_tokens:options.max_tokens||4096,
        tool:options.tool||'', reasoning:!!options.reasoning, reasoningTier:options.reasoningTier||'none',
        capability:options.capability||'', signal:options.signal||null
      };
      var result=await invokeWithRetry(payload,token);
      if(result.error)throw result.error;
      if(!result.data||!result.data.text)throw new Error('Edge Function đã phản hồi nhưng không có nội dung AI.');
      return result.data;
    }
  };
})();