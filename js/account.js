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
    },
    async manualResetTokens() {
      if (!supabase) return { error: { message: 'Supabase chưa sẵn sàng.' } };
      var token = await this.getAccessToken();
      var r = await supabase.functions.invoke('token-reset', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (r.error) return { error: r.error };
      var row = Array.isArray(r.data) ? r.data[0] : r.data;
      return { data: row };
    },
    async adminAction(action, payload) {
      if (!supabase) return { error: { message: 'Supabase chưa sẵn sàng.' } };
      var token = await this.getAccessToken();
      var r = await supabase.functions.invoke('owner-admin', {
        body: Object.assign({ action: action }, payload || {}),
        headers: { Authorization: 'Bearer ' + token }
      });
      if (r.error) return { error: r.error, data: r.data };
      if (r.data && r.data.error) return { error: { message: r.data.error }, data: r.data };
      return { data: r.data };
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
  var registerSuccess = document.getElementById('registerSuccess');
  var forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
  var resetForm = document.getElementById('resetForm');
  var resetError = document.getElementById('resetError');
  var resetSuccess = document.getElementById('resetSuccess');
  var googleBtn = document.getElementById('googleAuthBtn');
  var githubBtn = document.getElementById('githubAuthBtn');

  var checkoutBackdrop = document.getElementById('checkoutBackdrop');
  var closeCheckout = document.getElementById('closeCheckout');
  var checkoutPlanName = document.getElementById('checkoutPlanName');
  var checkoutPlanPrice = document.getElementById('checkoutPlanPrice');
  var checkoutError = document.getElementById('checkoutError');
  var checkoutStatus = document.getElementById('checkoutStatus');
  var confirmPaymentBtn = document.getElementById('confirmPaymentBtn');

  var PLAN_INFO = {};
  var PLAN_LABEL = {};
  var PLAN_FEATURES = {};
  var PLAN_ROWS = [];

  function formatVnd(n) {
    return Number(n || 0).toLocaleString('vi-VN') + 'đ';
  }

  function formatPlanPrice(plan) {
    if (Number(plan.price_vnd || 0) <= 0) return '0đ';
    return formatVnd(plan.price_vnd) + ' / ' + (plan.billing_period === 'year' ? 'năm' : 'tháng');
  }

  function applyPlanCatalog(plans) {
    PLAN_ROWS = Array.isArray(plans) ? plans.slice().sort(function(a,b){ return Number(b.priority||0)-Number(a.priority||0); }) : [];
    PLAN_INFO = {};
    PLAN_LABEL = {};
    PLAN_FEATURES = {};
    PLAN_ROWS.forEach(function (p) {
      PLAN_INFO[p.key] = {
        id: p.id, name: p.name, price: formatPlanPrice(p), amount: Number(p.price_vnd || 0),
        limit: Number(p.token_limit || 0), resetHours: Number(p.reset_hours || 6),
        enabled: p.enabled !== false, features: Array.isArray(p.features) ? p.features : []
      };
      PLAN_LABEL[p.key] = p.name.replace(/^Gói\\s+/i, '');
      PLAN_FEATURES[p.key] = Array.isArray(p.features) && p.features.length ? p.features : [
        Number(p.token_limit || 0).toLocaleString('vi-VN') + ' token / ' + Number(p.reset_hours || 6) + ' giờ'
      ];
    });
  }

  async function loadPlanCatalog() {
    if (!supabase) return [];
    var r = await supabase.from('plans')
      .select('id,key,name,description,price_vnd,billing_period,token_limit,reset_hours,reasoning_tier,default_model_key,model_tiers,capabilities,features,enabled,priority')
      .eq('enabled', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });
    if (!r.error) applyPlanCatalog(r.data || []);
    return r.data || [];
  }

  function renderPricingCards() {
    var grid = document.querySelector('.pricing-grid');
    if (!grid || !PLAN_ROWS.length) return;
    grid.innerHTML = PLAN_ROWS.filter(function(p){ return p.enabled !== false && p.key !== 'guest'; }).map(function(p, i) {
      var features = Array.isArray(p.features) ? p.features : [];
      var price = formatPlanPrice(p);
      var featured = i === 0 && PLAN_ROWS.filter(function(x){return x.key !== 'guest';}).length > 1;
      return '<div class="price-card ' + (featured ? 'is-featured' : '') + '" data-plan-card="' + escapeHtml(p.key) + '">' +
        (featured ? '<p class="price-tag">Nổi bật</p>' : '') +
        '<h3>' + escapeHtml(p.name.replace(/^Gói\\s+/i,'')) + '</h3>' +
        '<p class="price">' + escapeHtml(price.split(' / ')[0]) + '<span>' + (price.indexOf(' / ') >= 0 ? '/' + escapeHtml(price.split(' / ')[1]) : '') + '</span></p>' +
        '<ul>' + features.slice(0,7).map(function(f){ return '<li>' + escapeHtml(f) + '</li>'; }).join('') + '</ul>' +
        '<button type="button" class="btn ' + (featured ? 'btn-primary' : 'btn-outline') + ' plan-select-btn" data-plan="' + escapeHtml(p.key) + '" data-label="' + escapeHtml(p.key === 'free' ? 'Bắt đầu' : 'Chọn ' + p.name.replace(/^Gói\\s+/i,'')) + '">' + escapeHtml(p.key === 'free' ? 'Bắt đầu' : 'Chọn ' + p.name.replace(/^Gói\\s+/i,'')) + '</button>' +
        '</div>';
    }).join('');
    bindPlanButtons();
  }
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
    if (resetForm) resetForm.hidden = true;
    authTitle.textContent = tab === 'login' ? 'Đăng nhập' : 'Đăng ký';
    setError(loginError, null);
    setError(registerError, null);
    setError(registerSuccess, null);
    setError(resetError, null);
    setError(resetSuccess, null);
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

  if (forgotPasswordBtn) forgotPasswordBtn.addEventListener('click', async function () {
    var error = configured();
    if (error) return setError(loginError, error);
    var email = document.getElementById('loginEmail').value.trim().toLowerCase();
    if (!email) return setError(loginError, 'Hãy nhập email trước khi yêu cầu đặt lại mật khẩu.');
    forgotPasswordBtn.disabled = true;
    forgotPasswordBtn.textContent = 'Đang gửi…';
    var r = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname + '?reset=1'
    });
    forgotPasswordBtn.disabled = false;
    forgotPasswordBtn.textContent = 'Quên mật khẩu?';
    if (r.error) return setError(loginError, r.error.message);
    setError(loginError, null);
    alert('Đã gửi email đặt lại mật khẩu. Hãy kiểm tra hộp thư của bạn.');
  });

  if (resetForm) resetForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var error = configured();
    if (error) return setError(resetError, error);
    var password = document.getElementById('resetPassword').value;
    if (password.length < 6) return setError(resetError, 'Mật khẩu mới phải có ít nhất 6 ký tự.');
    var r = await supabase.auth.updateUser({ password: password });
    if (r.error) return setError(resetError, r.error.message);
    setError(resetError, null);
    setError(resetSuccess, 'Đổi mật khẩu thành công. Bạn có thể tiếp tục sử dụng Legendary AI.');
    document.getElementById('resetPassword').value = '';
    setTimeout(function () {
      if (resetForm) resetForm.hidden = true;
      setAuthTab('login');
      history.replaceState({}, document.title, window.location.pathname);
    }, 1200);
  });

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
    registerForm.reset();
    if (r.data.session) {
      closeAuthModal();
      await renderAccountArea();
      window.dispatchEvent(new CustomEvent('legendary:auth-changed'));
    } else {
      setError(registerError, null);
      setError(registerSuccess, 'Đăng ký thành công. Hãy kiểm tra email để xác nhận tài khoản, sau đó quay lại đăng nhập.');
    }
  });

  async function openOwnerDashboard() {
    var note = document.createElement('div');
    note.className = 'owner-panel owner-admin-panel';
    note.innerHTML =
      '<div class="owner-panel-head"><div><span class="section-tag">OWNER ADMIN</span><h3>Quản trị LegendaryAI</h3><p class="owner-admin-sub">Quản lý gói, quyền và hạn mức người dùng.</p></div><button class="btn btn-ghost btn-sm owner-close">✕</button></div>' +
      '<div class="owner-admin-tabs"><button class="btn btn-primary btn-sm owner-tab active" data-tab="plans">Gói người dùng</button><button class="btn btn-outline btn-sm owner-tab" data-tab="users">Người dùng</button></div>' +
      '<div class="owner-admin-body"><div class="owner-admin-loading">Đang tải…</div></div>';
    document.body.appendChild(note);
    note.querySelector('.owner-close').addEventListener('click', function(){ note.remove(); });
    var body=note.querySelector('.owner-admin-body');

    async function getAllPlans() {
      var r=await window.LegendaryBackend.adminAction('list_plans');
      if(r.error) throw new Error(r.error.message || 'Không tải được gói.');
      return r.data.plans || [];
    }

    function planFormHtml() {
      return '<form class="owner-plan-form">' +
        '<h4>Thêm gói mới</h4><div class="owner-form-grid">' +
        '<input name="key" placeholder="key: starter" required>' +
        '<input name="name" placeholder="Tên gói" required>' +
        '<input name="price_vnd" type="number" min="0" placeholder="Giá VND">' +
        '<input name="token_limit" type="number" min="1" placeholder="Token">' +
        '<input name="reset_hours" type="number" min="1" value="6" placeholder="Reset giờ">' +
        '<input name="default_model_key" placeholder="Model mặc định" value="legendary-lite-1">' +
        '</div><textarea name="description" placeholder="Mô tả gói"></textarea>' +
        '<input name="features" placeholder="Tính năng, ngăn cách bằng dấu |">' +
        '<div><button class="btn btn-primary btn-sm" type="submit">+ Thêm gói</button></div></form>';
    }

    async function renderPlans() {
      body.innerHTML='<div class="owner-admin-loading">Đang tải danh sách gói…</div>';
      var plans=await getAllPlans();
      body.innerHTML=planFormHtml()+'<div class="owner-plan-list">'+plans.map(function(p){
        return '<div class="owner-plan-row" data-id="'+escapeHtml(p.id)+'">' +
          '<div><strong>'+escapeHtml(p.name)+'</strong><small>'+escapeHtml(p.key)+' · '+formatVnd(p.price_vnd)+' · '+Number(p.token_limit||0).toLocaleString('vi-VN')+' token / '+Number(p.reset_hours||6)+'h</small></div>' +
          '<span class="plan-status '+(p.enabled?'on':'off')+'">'+(p.enabled?'Đang bật':'Đang tắt')+'</span>' +
          '<div class="owner-row-actions"><button class="btn btn-outline btn-sm plan-toggle">'+(p.enabled?'Tắt':'Bật')+'</button><button class="btn btn-outline btn-sm plan-edit">Sửa</button><button class="btn btn-ghost btn-sm plan-delete">Xoá</button></div>' +
          '</div>';
      }).join('')+'</div>';

      body.querySelector('.owner-plan-form').addEventListener('submit',async function(e){
        e.preventDefault();
        var f=e.currentTarget, fd=new FormData(f), features=String(fd.get('features')||'').split('|').map(function(x){return x.trim();}).filter(Boolean);
        var r=await window.LegendaryBackend.adminAction('create_plan',{
          key:fd.get('key'),name:fd.get('name'),description:fd.get('description'),price_vnd:Number(fd.get('price_vnd')||0),
          token_limit:Number(fd.get('token_limit')||500000),reset_hours:Number(fd.get('reset_hours')||6),
          default_model_key:fd.get('default_model_key'),features:features,model_tiers:['free']
        });
        if(r.error) return alert(r.error.message);
        alert('Đã thêm gói '+r.data.plan.name+'.'); await renderPlans(); await loadPlanCatalog(); renderPricingCards();
      });
      body.querySelectorAll('.plan-toggle').forEach(function(btn){
        btn.addEventListener('click',async function(){
          var row=btn.closest('.owner-plan-row'), p=plans.find(function(x){return x.id===row.getAttribute('data-id');});
          var r=await window.LegendaryBackend.adminAction('update_plan',{id:p.id,enabled:!p.enabled});
          if(r.error) return alert(r.error.message); await renderPlans(); await loadPlanCatalog(); renderPricingCards();
        });
      });
      body.querySelectorAll('.plan-edit').forEach(function(btn){
        btn.addEventListener('click',async function(){
          var row=btn.closest('.owner-plan-row'), p=plans.find(function(x){return x.id===row.getAttribute('data-id');});
          var name=prompt('Tên gói:',p.name); if(name===null) return;
          var price=prompt('Giá VND:',String(p.price_vnd||0)); if(price===null) return;
          var tokens=prompt('Token:',String(p.token_limit||500000)); if(tokens===null) return;
          var hours=prompt('Reset (giờ):',String(p.reset_hours||6)); if(hours===null) return;
          var r=await window.LegendaryBackend.adminAction('update_plan',{id:p.id,name:name,price_vnd:Number(price),token_limit:Number(tokens),reset_hours:Number(hours)});
          if(r.error) return alert(r.error.message); await renderPlans(); await loadPlanCatalog(); renderPricingCards();
        });
      });
      body.querySelectorAll('.plan-delete').forEach(function(btn){
        btn.addEventListener('click',async function(){
          var row=btn.closest('.owner-plan-row'), p=plans.find(function(x){return x.id===row.getAttribute('data-id');});
          if(!confirm('Xoá gói '+p.name+'? Gói đang có user/đơn hàng sẽ bị hệ thống chặn xoá.')) return;
          var r=await window.LegendaryBackend.adminAction('delete_plan',{id:p.id});
          if(r.error) return alert(r.error.message);
          await renderPlans(); await loadPlanCatalog(); renderPricingCards();
        });
      });
    }

    async function renderUsers() {
      body.innerHTML='<div class="owner-admin-loading">Đang tải người dùng…</div>';
      var plans=await getAllPlans();
      var r=await window.LegendaryBackend.adminAction('list_users',{page:1,perPage:100});
      if(r.error) throw new Error(r.error.message || 'Không tải được người dùng.');
      var users=r.data.users||[];
      body.innerHTML='<div class="owner-user-list">'+users.map(function(u){
        var p=u.profile||{};
        return '<div class="owner-user-row"><div><strong>'+escapeHtml(p.display_name||u.email||u.id)+'</strong><small>'+escapeHtml(u.email||'')+' · '+escapeHtml(p.plan||'free')+' · '+Number(p.tokens_used||0).toLocaleString('vi-VN')+'/'+Number(p.token_limit||0).toLocaleString('vi-VN')+'</small></div>' +
          '<select class="owner-user-plan" data-user="'+escapeHtml(u.id)+'">'+plans.filter(function(x){return x.key!=='guest';}).map(function(x){return '<option value="'+escapeHtml(x.key)+'" '+(x.key===(p.plan||'free')?'selected':'')+'>'+escapeHtml(x.name)+'</option>';}).join('')+'</select>' +
          '<button class="btn btn-outline btn-sm owner-user-reset" data-user="'+escapeHtml(u.id)+'">Reset token</button>' +
          '</div>';
      }).join('')+'</div>';
      body.querySelectorAll('.owner-user-plan').forEach(function(sel){
        sel.addEventListener('change',async function(){
          var r=await window.LegendaryBackend.adminAction('update_user',{user_id:sel.getAttribute('data-user'),plan_key:sel.value});
          if(r.error){alert(r.error.message);return;}
          alert('Đã đổi gói và reset token cho user.');
          await renderUsers();
        });
      });
      body.querySelectorAll('.owner-user-reset').forEach(function(btn){
        btn.addEventListener('click',async function(){
          var r=await window.LegendaryBackend.adminAction('update_user',{user_id:btn.getAttribute('data-user'),reset_tokens:true});
          if(r.error) return alert(r.error.message);
          await renderUsers();
        });
      });
    }

    note.querySelectorAll('.owner-tab').forEach(function(tab){
      tab.addEventListener('click',async function(){
        note.querySelectorAll('.owner-tab').forEach(function(x){x.classList.remove('active');});
        tab.classList.add('active');
        try { if(tab.getAttribute('data-tab')==='plans') await renderPlans(); else await renderUsers(); }
        catch(e){ body.innerHTML='<p class="auth-error">'+escapeHtml(e.message)+'</p>'; }
      });
    });
    try { await renderPlans(); } catch(e) { body.innerHTML='<p class="auth-error">'+escapeHtml(e.message)+'</p>'; }
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    await renderAccountArea();
    window.dispatchEvent(new CustomEvent('legendary:auth-changed'));
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var accountRenderSeq = 0;

  async function renderAccountArea() {
    if (!accountArea) return;
    var renderSeq = ++accountRenderSeq;
    accountArea.innerHTML = '';
    if (!supabase) {
      var btn = document.createElement('button');
      var authGroup = document.createElement('div');
      authGroup.className = 'account-auth-group';
      var loginBtn = document.createElement('button');
      loginBtn.type = 'button';
      loginBtn.className = 'btn btn-outline account-login-btn';
      loginBtn.textContent = 'Đăng nhập';
      loginBtn.addEventListener('click', function () { openAuthModal('login'); });
      var registerBtn = document.createElement('button');
      registerBtn.type = 'button';
      registerBtn.className = 'btn btn-primary account-register-btn';
      registerBtn.textContent = 'Đăng ký';
      registerBtn.addEventListener('click', function () { openAuthModal('register'); });
      authGroup.appendChild(loginBtn);
      authGroup.appendChild(registerBtn);
      accountArea.appendChild(authGroup);
      var headerCta = document.getElementById('headerTrialCta');
      if (headerCta) {
        headerCta.textContent = 'Dùng thử ngay';
        headerCta.href = '#demo';
        headerCta.title = 'Dùng thử Legendary AI';
      }
      renderPricingState(null);
      return;
    }

    var user = await LegendaryBackend.getUser();
    if (renderSeq !== accountRenderSeq) return;
    if (user && user.is_anonymous) {
      var guestBtn = document.createElement('button');
      guestBtn.type = 'button';
      var guestAuthGroup = document.createElement('div');
      guestAuthGroup.className = 'account-auth-group';
      var guestLoginBtn = document.createElement('button');
      guestLoginBtn.type = 'button';
      guestLoginBtn.className = 'btn btn-outline account-login-btn guest-account-btn';
      guestLoginBtn.textContent = 'Đăng nhập';
      guestLoginBtn.title = 'Đăng nhập để lưu lịch sử và nâng hạn mức';
      guestLoginBtn.addEventListener('click', function () { openAuthModal('login'); });
      var guestRegisterBtn = document.createElement('button');
      guestRegisterBtn.type = 'button';
      guestRegisterBtn.className = 'btn btn-primary account-register-btn';
      guestRegisterBtn.textContent = 'Đăng ký';
      guestRegisterBtn.title = 'Tạo tài khoản LegendaryAI';
      guestRegisterBtn.addEventListener('click', function () { openAuthModal('register'); });
      guestAuthGroup.appendChild(guestLoginBtn);
      guestAuthGroup.appendChild(guestRegisterBtn);
      accountArea.appendChild(guestAuthGroup);
      var guestLabel = document.createElement('span');
      guestLabel.className = 'guest-plan-chip';
      guestLabel.textContent = 'Khách · 1K';
      accountArea.appendChild(guestLabel);
      var guestCta = document.getElementById('headerTrialCta');
      if (guestCta) {
        guestCta.textContent = 'Khách · 1K';
        guestCta.href = '#demo';
        guestCta.title = 'Phiên khách: tối đa 1.000 token';
      }
      renderPricingState(null);
      return;
    }

    if (!user) {
      var loginBtn = document.createElement('button');
      loginBtn.type = 'button';
      var loggedOutAuthGroup = document.createElement('div');
      loggedOutAuthGroup.className = 'account-auth-group';
      loginBtn.type = 'button';
      loginBtn.className = 'btn btn-outline account-login-btn';
      loginBtn.textContent = 'Đăng nhập';
      loginBtn.addEventListener('click', function () { openAuthModal('login'); });
      var loggedOutRegisterBtn = document.createElement('button');
      loggedOutRegisterBtn.type = 'button';
      loggedOutRegisterBtn.className = 'btn btn-primary account-register-btn';
      loggedOutRegisterBtn.textContent = 'Đăng ký';
      loggedOutRegisterBtn.addEventListener('click', function () { openAuthModal('register'); });
      loggedOutAuthGroup.appendChild(loginBtn);
      loggedOutAuthGroup.appendChild(loggedOutRegisterBtn);
      accountArea.appendChild(loggedOutAuthGroup);
      var headerCta = document.getElementById('headerTrialCta');
      if (headerCta) {
        headerCta.textContent = 'Dùng thử ngay';
        headerCta.href = '#demo';
        headerCta.title = 'Dùng thử Legendary AI';
      }
      renderPricingState(null);
      return;
    }

    var profile = await LegendaryBackend.getProfile();
    if (renderSeq !== accountRenderSeq) return;
    profile = profile || { plan: 'free', token_limit: 500000, tokens_used: 0 };
    var name = (profile.display_name || user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name) || user.email || 'User');
    // The main header CTA becomes the signed-in account name.
    var headerCta = document.getElementById('headerTrialCta');
    if (headerCta) {
      headerCta.textContent = name;
      headerCta.href = '#demo';
      headerCta.title = 'Mở khu vực dùng thử';
    }

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
      '<p class="acc-plan-line">Token còn lại: <strong>' + Math.max(Number(profile.token_limit || 0) - Number(profile.tokens_used || 0), 0).toLocaleString('vi-VN') + ' / ' + Number(profile.token_limit || 500000).toLocaleString('vi-VN') + '</strong></p>' +
      (profile.role === 'owner' ? '<p class="acc-plan-line"><strong>Quyền Owner</strong> · Quản trị hệ thống</p>' : '') +
      '<div class="acc-features"><strong>Quyền gói</strong>' + (PLAN_FEATURES[profile.plan] || PLAN_FEATURES.free).map(function (f) { return '<span>' + escapeHtml(f) + '</span>'; }).join('') + '</div>';

    var logout = document.createElement('button');
    logout.className = 'btn btn-outline btn-sm';
    logout.textContent = 'Đăng xuất';
    logout.addEventListener('click', signOut);
    if (profile.plan === 'pro' || profile.plan === 'legendary' || profile.role === 'owner') {
      var quotaBtn = document.createElement('button');
      quotaBtn.className = 'btn btn-outline btn-sm';
      quotaBtn.textContent = '↻ Làm mới hạn mức';
      quotaBtn.style.marginBottom = '8px';
      quotaBtn.addEventListener('click', async function () {
        quotaBtn.disabled = true;
        var result = await window.LegendaryBackend.manualResetTokens();
        if (!result.data || !result.data.success) {
          alert((result.error && result.error.message) || (result.data && result.data.message) || 'Không thể làm mới hạn mức.');
        } else {
          alert('Đã làm mới hạn mức.');
          renderAccount();
        }
        quotaBtn.disabled = false;
      });
      dropdown.appendChild(quotaBtn);
    }

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
    menu.appendChild(trigger);
    menu.appendChild(dropdown);
    if (renderSeq !== accountRenderSeq) return;
    accountArea.innerHTML = '';
    accountArea.appendChild(menu);
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

  function bindPlanButtons() {
    document.querySelectorAll('.plan-select-btn').forEach(function (btn) {
      btn.onclick = function () { handlePlanSelect(btn.getAttribute('data-plan')); };
    });
  }

  loadPlanCatalog().then(function(){ renderPricingCards(); }).catch(function(){});
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
      // Update account UI and notify the chat HUD after the profile is ready.
      // This prevents the token pill from getting stuck at "—" after login.
      setTimeout(async function () {
        await renderAccountArea();
        window.dispatchEvent(new CustomEvent('legendary:profile-ready'));
      }, 0);
    });
  }

  renderAccountArea().then(function () {
    window.dispatchEvent(new CustomEvent('legendary:profile-ready'));
  });
  window.LegendaryAuth = {
    currentUser: async function () { return LegendaryBackend.getUser(); },
    logoutUser: signOut,
    openAuth: openAuthModal
  };

  if (new URLSearchParams(location.search).get('reset') === '1' && resetForm) {
    setTimeout(async function () {
      if (!supabase) return;
      var user = await LegendaryBackend.getUser();
      if (user) {
        setAuthTab('login');
        loginForm.hidden = true;
        registerForm.hidden = true;
        resetForm.hidden = false;
        authTitle.textContent = 'Đặt lại mật khẩu';
        authBackdrop.classList.add('open');
      }
    }, 250);
  }

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

  // Do not reload the whole page after auth changes. Re-render the account
  // control in place so the header can update without interrupting the current UI,
  // scroll position, chat draft, or open sections.
  window.addEventListener('legendary:auth-changed', function () {
    renderAccountArea();
  });
})();
