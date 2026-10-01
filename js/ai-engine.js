(function () {
  'use strict';
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  async function ensureAuthSession() {
    if (!window.LegendaryBackend || !window.LegendaryBackend.client) {
      throw new Error('Supabase chưa sẵn sàng.');
    }
    var token = await window.LegendaryBackend.getAccessToken();
    if (token) return token;

    throw new Error('Bạn đang ở chế độ khách. Hãy Đăng nhập hoặc Đăng ký để sử dụng Legendary Engine.');
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
    async image(options){
      options=options||{};
      var token=await ensureAuthSession();
      if(!token) throw new Error('Supabase chưa sẵn sàng.');
      var prompt=String(options.prompt||'').trim();
      if(!prompt) throw new Error('Prompt tạo ảnh không được để trống.');
      var config=window.LEGENDARY_SUPABASE_CONFIG||{};
      var baseUrl=String(config.url||'').replace(/\/$/,'');
      var anonKey=String(config.anonKey||'');
      if(!baseUrl||!anonKey) throw new Error('Supabase client chưa được cấu hình.');
      var response=await fetch(baseUrl+'/functions/v1/image-generate',{
        method:'POST',
        headers:{'Content-Type':'application/json',apikey:anonKey,Authorization:'Bearer '+token},
        body:JSON.stringify({
          prompt:prompt,
          size:options.size||'auto',
          quality:options.quality||'auto',
          background:options.background||'auto'
        }),
        signal:options.signal||undefined
      });
      var raw=await response.text(),data=null;
      try{data=raw?JSON.parse(raw):null}catch(_){}
      if(!response.ok) throw new Error((data&&(data.error||data.message))||raw.slice(0,800)||('HTTP '+response.status));
      if(!data||!data.imageDataUrl) throw new Error('Image Provider không trả về ảnh.');
      return data;
    },
    async chat(options){
      options=options||{};
      var token=await ensureAuthSession();
      if(!token) throw new Error('Supabase chưa sẵn sàng.');
      if(!options.messages||!options.messages.length) throw new Error('Không có nội dung để gửi — hãy nhập tin nhắn trước khi gửi.');
      var payload={
        model:options.model||'auto', messages:options.messages||[], system:options.system||'',
        temperature:options.temperature??0.35, max_tokens:options.max_tokens||4096,
        tool:options.tool||'', reasoning:!!options.reasoning, reasoningTier:options.reasoningTier||'none',
        analysis_level:options.analysisLevel||0, mode:options.mode||'general',
        capability:options.capability||'', signal:options.signal||null
      };
      var result=await invokeWithRetry(payload,token);
      if(result.error)throw result.error;
      if(!result.data||!result.data.text)throw new Error('Edge Function đã phản hồi nhưng không có nội dung AI.');
      return result.data;
    }
  };
})();