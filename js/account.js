(function () {
  'use strict';

  var cfg = window.LEGENDARY_SUPABASE_CONFIG || {};
  var supabase = null;
  if (window.supabase && cfg.url && !cfg.url.includes('YOUR_PROJECT_REF') && cfg.anonKey && !cfg.anonKey.includes('YOUR_SUPABASE_ANON_KEY')) {
    supabase = window.supabase.createClient(cfg.url, cfg.anonKey);
  }

  window.LegendaryBackend = {
    enabled: !!supabase,
    client: supabase,
    async getUser() {
      if (!supabase) return null;
      var r = await supabase.auth.getUser();
      return r.data && r.data.user ? r.data.user : null;
    },
    async getAccessToken() {
      if (!supabase) return null;
      var r = await supabase.auth.getSession();
      return r.data && r.data.session ? r.data.session.access_token : null;
    },
    async getProfile() {
      var user = await this.getUser();
      if (!user) return null;
      var r = await supabase.from('profiles').select('*').eq('id', user.id).single();
      return r.data || null;
    }
  };

  var accountArea = document.getElementById('accountArea');
  var authBackdrop = document.getElementById('authBackdrop');
  var closeAuth = document.getElementById('closeAuth');
  var authTitle = document.getElementById('authTitle');
  var authTabs = document.querySelectorAll('.auth-tab');
  var loginForm = document.getElementById('loginForm');
  var registerForm = document.getElementById('registerForm');
  var loginError = document.getElementById('loginError');
  var registerError = document.getElementById('registerError');
  var googleBtn = document.getElementById('googleAuthBtn');
  var githubBtn = document.getElementById('githubAuthBtn');

  var checkoutBackdrop = document.getElementById('checkoutBackdrop');
  var closeCheckout = document.getElementById('closeCheckout');
  var checkoutPlanName = document.getElementById('checkoutPlanName');
  var checkoutPlanPrice = document.getElementById('checkoutPlanPrice');
  var checkoutError = document.getElementById('checkoutError');
  var checkoutStatus = document.getElementById('checkoutStatus');
  var confirmPaymentBtn = document.getElementById('confirmPaymentBtn');

  var PLAN_INFO = {
    free: { name: 'Gói Free', price: '0đ / tháng', amount: 0, limit: 250000 },
    pro: { name: 'Gói Pro', price: '299.000đ / tháng', amount: 299000, limit: 300000 },
    legendary: { name: 'Gói Legendary', price: '899.000đ / tháng', amount: 899000, limit: 1000000 }
  };
  var PLAN_LABEL = { free: 'Free', pro: 'Pro', legendary: 'Legendary' };
  var pendingPlan = null, checkoutPlan = null;

  function configured() {
    if (!supabase) {
      return 'Chưa cấu hình Supabase. Hãy điền URL + anon key trong js/supabase-config.js và chạy supabase/schema.sql.';
    }
    return null;
  }

  function setError(el, message) {
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  function setAuthTab(tab) {
    authTabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === tab); });
    loginForm.hidden = tab !== 'login';
    registerForm.hidden = tab !== 'register';
    authTitle.textContent = tab === 'login' ? 'Đăng nhập' : 'Đăng ký';
    setError(loginError, null);
    setError(registerError, null);
  }

  function openAuthModal(tab) {
    setAuthTab(tab || 'login');
    authBackdrop.classList.add('open');
  }
  function closeAuthModal() { authBackdrop.classList.remove('open'); }

  authTabs.forEach(function (t) {
    t.addEventListener('click', function () { setAuthTab(t.getAttribute('data-tab')); });
  });
  if (closeAuth) closeAuth.addEventListener('click', closeAuthModal);
  if (authBackdrop) authBackdrop.addEventListener('click', function (e) {
    if (e.target === authBackdrop) closeAuthModal();
  });

  async function signInOAuth(provider) {
    var error = configured();
    if (error) return setError(loginError, error);
    var r = await supabase.auth.signInWithOAuth({
      provider: provider,
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (r.error) setError(loginError, r.error.message);
  }

  if (googleBtn) googleBtn.addEventListener('click', function () { signInOAuth('google'); });
  if (githubBtn) githubBtn.addEventListener('click', function () { signInOAuth('github'); });

  if (loginForm) loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var error = configured();
    if (error) return setError(loginError, error);
    var email = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPassword').value;
    var r = await supabase.auth.signInWithPassword({ email: email, password: password });
    if (r.error) return setError(loginError, r.error.message);
    closeAuthModal();
    loginForm.reset();
    await renderAccountArea();
    window.dispatchEvent(new CustomEvent('legendary:auth-changed'));
  });

  if (registerForm) registerForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var error = configured();
    if (error) return setError(registerError, error);
    var name = document.getElementById('registerName').value.trim();
    var email = document.getElementById('registerEmail').value.trim().toLowerCase();
    var password = document.getElementById('registerPassword').value;
    if (!name || !email || password.length < 6) return setError(registerError, 'Vui lòng nhập họ tên, email và mật khẩu từ 6 ký tự.');
    var r = await supabase.auth.signUp({
      email: email,
      password: password,
      options: { data: { full_name: name } }
    });
    if (r.error) return setError(registerError, r.error.message);
    closeAuthModal();
    registerForm.reset();
    if (r.data.session) {
      await renderAccountArea();
      window.dispatchEvent(new CustomEvent('legendary:auth-changed'));
    } else {
      alert('Đăng ký thành công. Hãy kiểm tra email để xác nhận tài khoản.');
    }
  });

  async function openOwnerDashboard() {
    var note = document.createElement('div');
    note.className = 'owner-panel';
    note.innerHTML = '<div class="owner-panel-head"><div><span class="section-tag">OWNER</span><h3>Bảng điều khiển LegendaryAI</h3></div><button class="btn btn-ghost btn-sm owner-close">✕</button></div><div class="owner-stats-grid"><div><span>Đang tải…</span></div></div><div class="owner-orders"></div>';
    document.body.appendChild(note);
    note.querySelector('.owner-close').addEventListener('click', function(){ note.remove(); });
    try {
      var result = await sb.functions.invoke('owner-stats', {
        headers: { Authorization: 'Bearer ' + await window.LegendaryBackend.getAccessToken() }
      });
      if (result.error || !result.data) throw new Error((result.data && result.data.error) || result.error.message || 'Không tải được dashboard.');
      var d = result.data;
      var stats = note.querySelector('.owner-stats-grid');
      stats.innerHTML =
        '<div><strong>' + Number(d.users || 0).toLocaleString('vi-VN') + '</strong><span>Người dùng</span></div>' +
        '<div><strong>' + Number(d.conversations || 0).toLocaleString('vi-VN') + '</strong><span>Hội thoại</span></div>' +
        '<div><strong>' + Number(d.paidOrders || 0).toLocaleString('vi-VN') + '</strong><span>Đơn đã thanh toán</span></div>' +
        '<div><strong>' + Number(d.revenueVnd || 0).toLocaleString('vi-VN') + 'đ</strong><span>Doanh thu</span></div>';
      note.querySelector('.owner-orders').innerHTML = '<h4>Đơn gần đây</h4>' +
        '<div class="owner-order-list">' + (d.recentOrders || []).map(function(o) {
          return '<div><span>' + escapeHtml(o.plan || '') + '</span><span>' + escapeHtml(o.status || '') + '</span><strong>' + Number(o.amount || 0).toLocaleString('vi-VN') + 'đ</strong></div>';
        }).join('') + '</div>';
    } catch (e) {
      note.querySelector('.owner-stats-grid').innerHTML = '<p class="auth-error">' + escapeHtml(e.message) + '</p>';
    }
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    await renderAccountArea();
    window.dispatchEvent(new CustomEvent('legendary:auth-changed'));
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function renderAccountArea() {
    if (!accountArea) return;
    accountArea.innerHTML = '';
    if (!supabase) {
      var btn = document.createElement('button');
      btn.className = 'btn btn-outline account-login-btn';
      btn.textContent = 'Đăng nhập';
      btn.addEventListener('click', function () { openAuthModal('login'); });
      accountArea.appendChild(btn);
      renderPricingState(null);
      return;
    }

    var user = await LegendaryBackend.getUser();
    if (!user) {
      var loginBtn = document.createElement('button');
      loginBtn.type = 'button';
      loginBtn.className = 'btn btn-outline account-login-btn';
      loginBtn.textContent = 'Đăng nhập';
      loginBtn.addEventListener('click', function () { openAuthModal('login'); });
      accountArea.appendChild(loginBtn);
      renderPricingState(null);
      return;
    }

    var profile = await LegendaryBackend.getProfile();
    profile = profile || { plan: 'free', token_limit: 250000, tokens_used: 0 };
    var name = (profile.display_name || user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name) || user.email || 'User');
    var menu = document.createElement('div');
    menu.className = 'account-menu';

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'account-trigger';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = '<span class="account-avatar">' + escapeHtml(name.charAt(0).toUpperCase()) + '</span>' +
      '<span class="account-name">' + escapeHtml(name) + '</span>' +
      '<span class="plan-chip plan-' + profile.plan + '">' + PLAN_LABEL[profile.plan] + '</span>' +
      (profile.role === 'owner' ? '<span class="role-chip role-owner">OWNER</span>' : '');

    var dropdown = document.createElement('div');
    dropdown.className = 'account-dropdown';
    dropdown.innerHTML = '<p class="acc-email">' + escapeHtml(user.email || '') + '</p>' +
      '<p class="acc-plan-line">Gói hiện tại: <strong>' + PLAN_LABEL[profile.plan] + '</strong></p>' +
      '<p class="acc-plan-line">Token: <strong>' + Number(profile.tokens_used || 0).toLocaleString('vi-VN') + ' / ' + Number(profile.token_limit || 250000).toLocaleString('vi-VN') + '</strong></p>' +
      (profile.role === 'owner' ? '<p class="acc-plan-line"><strong>Quyền Owner</strong> · Quản trị hệ thống</p>' : '');

    var logout = document.createElement('button');
    logout.className = 'btn btn-outline btn-sm';
    logout.textContent = 'Đăng xuất';
    logout.addEventListener('click', signOut);
    if (profile.role === 'owner') {
      var ownerBtn = document.createElement('button');
      ownerBtn.className = 'btn btn-primary btn-sm';
      ownerBtn.textContent = '⚙ Quản trị Owner';
      ownerBtn.style.marginBottom = '8px';
      ownerBtn.addEventListener('click', openOwnerDashboard);
      dropdown.appendChild(ownerBtn);
    }
    dropdown.appendChild(logout);

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = dropdown.classList.toggle('open');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    menu.appendChild(trigger); menu.appendChild(dropdown); accountArea.appendChild(menu);
    renderPricingState(profile);
  }

  function renderPricingState(profile) {
    document.querySelectorAll('.plan-select-btn').forEach(function (btn) {
      var card = btn.closest('.price-card');
      var tag = card && card.querySelector('.price-current-tag');
      if (tag) tag.remove();
      var plan = btn.getAttribute('data-plan');
      if (profile && profile.plan === plan) {
        btn.disabled = true; btn.textContent = 'Đang dùng gói này';
        var t = document.createElement('span'); t.className = 'price-current-tag'; t.textContent = 'Gói hiện tại';
        card.appendChild(t);
      } else {
        btn.disabled = false; btn.textContent = btn.getAttribute('data-label') || btn.textContent;
      }
    });
  }

  async function handlePlanSelect(plan) {
    if (plan === 'free') {
      var user = await LegendaryBackend.getUser();
      if (!user) { pendingPlan = plan; return openAuthModal('login'); }
      return;
    }
    var user = await LegendaryBackend.getUser();
    if (!user) { pendingPlan = plan; return openAuthModal('login'); }
    openCheckout(plan);
  }

  document.querySelectorAll('.plan-select-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { handlePlanSelect(btn.getAttribute('data-plan')); });
  });

  async function openCheckout(plan) {
    checkoutPlan = plan;
    var info = PLAN_INFO[plan];
    checkoutPlanName.textContent = info.name;
    checkoutPlanPrice.textContent = info.price;
    setError(checkoutError, null);
    if (checkoutStatus) checkoutStatus.hidden = true;
    confirmPaymentBtn.disabled = false;
    confirmPaymentBtn.textContent = 'Tạo thanh toán MoMo';
    checkoutBackdrop.classList.add('open');
  }

  if (closeCheckout) closeCheckout.addEventListener('click', function () { checkoutBackdrop.classList.remove('open'); });
  if (checkoutBackdrop) checkoutBackdrop.addEventListener('click', function (e) {
    if (e.target === checkoutBackdrop) checkoutBackdrop.classList.remove('open');
  });

  if (confirmPaymentBtn) confirmPaymentBtn.addEventListener('click', async function () {
    var error = configured();
    if (error) return setError(checkoutError, error);
    var user = await LegendaryBackend.getUser();
    if (!user) {
      checkoutBackdrop.classList.remove('open');
      return openAuthModal('login');
    }

    confirmPaymentBtn.disabled = true;
    confirmPaymentBtn.textContent = 'Đang tạo đơn MoMo…';
    if (checkoutStatus) { checkoutStatus.hidden = false; checkoutStatus.textContent = 'Đang tạo yêu cầu thanh toán an toàn trên máy chủ…'; }

    var token = await LegendaryBackend.getAccessToken();
    var r = await supabase.functions.invoke('momo-create-payment', {
      body: { plan: checkoutPlan },
      headers: { Authorization: 'Bearer ' + token }
    });
    if (r.error || !r.data || !r.data.payUrl) {
      confirmPaymentBtn.disabled = false;
      confirmPaymentBtn.textContent = 'Tạo thanh toán MoMo';
      return setError(checkoutError, (r.data && r.data.error) || (r.error && r.error.message) || 'Không tạo được giao dịch MoMo.');
    }

    if (checkoutStatus) checkoutStatus.textContent = 'Đã tạo đơn. Đang chuyển sang MoMo…';
    window.location.href = r.data.payUrl;
  });

  document.addEventListener('click', function (e) {
    var dropdown = document.querySelector('.account-dropdown.open');
    if (dropdown && !dropdown.parentNode.contains(e.target)) dropdown.classList.remove('open');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeAuthModal();
      if (checkoutBackdrop) checkoutBackdrop.classList.remove('open');
    }
  });

  if (supabase) {
    supabase.auth.onAuthStateChange(function (_event) {
      setTimeout(function () { renderAccountArea(); }, 0);
    });
  }

  renderAccountArea();
  window.LegendaryAuth = {
    currentUser: async function () { return LegendaryBackend.getUser(); },
    logoutUser: signOut,
    openAuth: openAuthModal
  };

  // Resume a checkout redirect with a small status notice. Payment status is always
  // authoritative from the MoMo IPN -> backend -> database flow.
  if (new URLSearchParams(location.search).get('payment')) {
    setTimeout(function () {
      var box = document.createElement('div');
      box.className = 'payment-return-note';
      box.textContent = 'Đã quay lại LegendaryAI. Trạng thái thanh toán sẽ được cập nhật sau khi MoMo xác nhận giao dịch.';
      document.body.appendChild(box);
      setTimeout(function () { box.remove(); }, 7000);
    }, 500);
  }

  window.addEventListener('legendary:auth-changed', function () {
    setTimeout(function () { location.reload(); }, 100);
  });
})();