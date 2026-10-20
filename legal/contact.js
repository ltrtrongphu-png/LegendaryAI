(function () {
  'use strict';
  var form = document.getElementById('contactForm');
  var submit = document.getElementById('contactSubmit');
  var status = document.getElementById('contactStatus');
  if (!form || !submit || !status) return;
  function show(message, bad) {
    status.hidden = false;
    status.textContent = message;
    status.style.border = bad ? '1px solid #b35b5b' : '1px solid #4476c5';
  }
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var cfg = window.LEGENDARY_SUPABASE_CONFIG || {};
    if (!cfg.url || !cfg.anonKey) return show('Cấu hình gửi yêu cầu chưa sẵn sàng. Vui lòng thử lại sau.', true);
    var email = document.getElementById('contactEmail').value.trim();
    var topic = document.getElementById('contactTopic').value;
    var message = document.getElementById('contactMessage').value.trim();
    if (!email || message.length < 15 || message.length > 15000) return show('Vui lòng kiểm tra email và nội dung (15–15.000 ký tự).', true);
    submit.disabled = true;
    submit.textContent = 'Đang gửi…';
    try {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 12000);
      var response = await fetch(cfg.url.replace(/\/$/, '') + '/functions/v1/support-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.anonKey },
        body: JSON.stringify({ email: email, topic: topic, message: message }),
        signal: controller.signal
      });
      clearTimeout(timer);
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok || !data.ok) throw new Error(data.error || 'Không gửi được yêu cầu.');
      form.reset();
      show('Đã ghi nhận yêu cầu. Mã phiếu: ' + data.ticket_id + '. Email phản hồi tự động chưa được cấu hình; vui lòng lưu mã này.', false);
    } catch (error) {
      show(error && error.name === 'AbortError' ? 'Máy chủ phản hồi quá lâu. Hãy thử lại sau.' : (error && error.message ? error.message : 'Không gửi được yêu cầu.'), true);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Gửi yêu cầu';
    }
  });
}());