(function () {
  'use strict';
  var status = document.getElementById('paymentStatus');
  var details = document.getElementById('paymentDetails');
  function report(message, bad) {
    status.hidden = false;
    status.textContent = message;
    status.style.border = bad ? '1px solid #b35b5b' : '1px solid #4476c5';
  }
  function value(id, text) { document.getElementById(id).textContent = text || '—'; }
  function money(amount, currency) {
    var n = Number(amount);
    return Number.isFinite(n) ? n.toLocaleString('vi-VN') + ' ' + (currency || 'VND') : '—';
  }
  async function run() {
    var params = new URLSearchParams(window.location.search);
    var orderId = params.get('payment') || '';
    if (!/^LAI_[A-Za-z0-9]{12,40}$/.test(orderId)) return report('Không tìm thấy mã đơn hợp lệ. Nếu bạn vừa thanh toán, hãy vào trang tài khoản và đối soát sau ít phút.', true);
    var cfg = window.LEGENDARY_SUPABASE_CONFIG || {};
    if (!window.supabase || !cfg.url || !cfg.anonKey) return report('Cấu hình Supabase chưa sẵn sàng. Trạng thái thanh toán chưa thể xác minh.', true);
    var client = window.supabase.createClient(cfg.url, cfg.anonKey);
    var sessionResult = await client.auth.getSession();
    var session = sessionResult && sessionResult.data && sessionResult.data.session;
    if (!session || !session.access_token) return report('Hãy đăng nhập bằng đúng tài khoản đã tạo đơn hàng rồi tải lại trang này để kiểm tra trạng thái.', true);
    try {
      var response = await fetch(cfg.url.replace(/\/$/, '') + '/functions/v1/account-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.anonKey, 'Authorization': 'Bearer ' + session.access_token },
        body: JSON.stringify({ action: 'payment-status', orderId: orderId })
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok || !payload.ok || !payload.order) throw new Error(payload.error || 'Không thể xác minh đơn hàng.');
      var order = payload.order;
      value('paymentOrder', order.provider_order_id);
      value('paymentPlan', order.plan);
      value('paymentAmount', money(order.amount, order.currency));
      value('paymentState', order.status);
      value('paymentPaidAt', order.paid_at ? new Date(order.paid_at).toLocaleString('vi-VN') : 'Chưa xác nhận');
      value('paymentExpiresAt', order.expires_at ? new Date(order.expires_at).toLocaleString('vi-VN') : 'Chưa có');
      details.hidden = false;
      if (order.status === 'paid') report('Thanh toán đã được backend xác nhận. Gói đã được kích hoạt theo trạng thái đơn hàng.', false);
      else if (order.status === 'pending') report('Đơn đang chờ MoMo/IPN xác nhận. Không thanh toán lại trước khi đối soát trạng thái.', false);
      else report('Đơn hàng hiện ở trạng thái ' + order.status + '. Nếu tiền đã bị trừ, gửi mã đơn qua biểu mẫu hỗ trợ.', true);
    } catch (error) {
      report(error && error.message ? error.message : 'Không thể xác minh trạng thái.', true);
    } finally {
      await client.auth.signOut().catch(function () {});
    }
  }
  run().catch(function () { report('Không thể xác minh trạng thái thanh toán. Vui lòng thử lại sau.', true); });
}());