(function () {
  // -----------------------------------------------------------------------
  // Core auth "backend" simulated with localStorage.
  // NOT SECURE — demo only. A real product must authenticate on a server.
  // -----------------------------------------------------------------------
  var USERS_KEY = 'legendaryai_users_v1';
  var SESSION_KEY = 'legendaryai_session_v1';
  var ORDERS_KEY = 'legendaryai_orders_v1';

  function loadUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch (e) { return []; }
  }
  function saveUsers(list) {
    try { localStorage.setItem(USERS_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }
  function getSessionId() {
    try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
  }
  function setSessionId(id) {
    try {
      if (id) localStorage.setItem(SESSION_KEY, id);
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
  }
  function loadOrders() {
    try { return JSON.parse(localStorage.getItem(ORDERS_KEY)) || []; } catch (e) { return []; }
  }
  function saveOrders(list) {
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  // Not real cryptography — only meant to avoid storing raw passwords in plain text
  // in this static-site demo. Replace with real hashing (bcrypt/argon2) on a server.
  function simpleHash(str) {
    var h = 0;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return 'h' + h;
  }

  function findUserByEmail(email) {
    email = (email || '').trim().toLowerCase();
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].email === email) return users[i];
    }
    return null;
  }
  function findUserById(id) {
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id) return users[i];
    }
    return null;
  }
  function currentUser() {
    var id = getSessionId();
    return id ? findUserById(id) : null;
  }

  function registerUser(name, email, password) {
    name = (name || '').trim();
    email = (email || '').trim().toLowerCase();
    if (!name || !email || !password) return { error: 'Vui lòng nhập đầy đủ thông tin.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Email không hợp lệ.' };
    if (String(password).length < 6) return { error: 'Mật khẩu cần ít nhất 6 ký tự.' };
    if (findUserByEmail(email)) return { error: 'Email này đã được đăng ký. Hãy đăng nhập.' };
    var users = loadUsers();
    var user = {
      id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: name, email: email, passHash: simpleHash(password),
      plan: 'free', planActivatedAt: null, createdAt: Date.now()
    };
    users.push(user);
    saveUsers(users);
    setSessionId(user.id);
    return { user: user };
  }

  function loginUser(email, password) {
    var user = findUserByEmail(email);
    if (!user || user.passHash !== simpleHash(password)) {
      return { error: 'Email hoặc mật khẩu không đúng.' };
    }
    setSessionId(user.id);
    return { user: user };
  }

  function logoutUser() {
    setSessionId(null);
  }

  function setUserPlan(userId, plan) {
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === userId) {
        users[i].plan = plan;
        users[i].planActivatedAt = Date.now();
        break;
      }
    }
    saveUsers(users);
  }

  function recordOrder(userId, plan, amountLabel) {
    var orders = loadOrders();
    orders.push({
      id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      userId: userId, plan: plan, amountLabel: amountLabel,
      method: 'momo', status: 'success', createdAt: Date.now()
    });
    saveOrders(orders);
  }

  window.LegendaryAuth = {
    currentUser: currentUser,
    registerUser: registerUser,
    loginUser: loginUser,
    logoutUser: logoutUser,
    setUserPlan: setUserPlan,
    recordOrder: recordOrder
  };

  // -----------------------------------------------------------------------
  // UI wiring
  // -----------------------------------------------------------------------
  var accountArea = document.getElementById('accountArea');

  var authBackdrop = document.getElementById('authBackdrop');
  var closeAuth = document.getElementById('closeAuth');
  var authTitle = document.getElementById('authTitle');
  var authTabs = document.querySelectorAll('.auth-tab');
  var loginForm = document.getElementById('loginForm');
  var registerForm = document.getElementById('registerForm');
  var loginError = document.getElementById('loginError');
  var registerError = document.getElementById('registerError');

  var checkoutBackdrop = document.getElementById('checkoutBackdrop');
  var closeCheckout = document.getElementById('closeCheckout');
  var checkoutPlanName = document.getElementById('checkoutPlanName');
  var checkoutPlanPrice = document.getElementById('checkoutPlanPrice');
  var momoPhone = document.getElementById('momoPhone');
  var checkoutError = document.getElementById('checkoutError');
  var checkoutStatus = document.getElementById('checkoutStatus');
  var confirmPaymentBtn = document.getElementById('confirmPaymentBtn');

  var PLAN_INFO = {
    free: { name: 'Gói Free', price: '0đ / tháng' },
    pro: { name: 'Gói Pro', price: '299.000đ / tháng' },
    legendary: { name: 'Gói Legendary', price: '899.000đ / tháng' }
  };
  var PLAN_LABEL = { free: 'Free', pro: 'Pro', legendary: 'Legendary' };

  var pendingPlan = null;
  var checkoutPlan = null;

  function openAuthModal(tab) {
    setAuthTab(tab || 'login');
    authBackdrop.classList.add('open');
  }
  function closeAuthModal() {
    authBackdrop.classList.remove('open');
  }
  function setAuthTab(tab) {
    authTabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === tab); });
    loginForm.hidden = tab !== 'login';
    registerForm.hidden = tab !== 'register';
    authTitle.textContent = tab === 'login' ? 'Đăng nhập' : 'Đăng ký';
    loginError.hidden = true;
    registerError.hidden = true;
  }
  authTabs.forEach(function (t) {
    t.addEventListener('click', function () { setAuthTab(t.getAttribute('data-tab')); });
  });
  if (closeAuth) closeAuth.addEventListener('click', closeAuthModal);
  if (authBackdrop) {
    authBackdrop.addEventListener('click', function (e) { if (e.target === authBackdrop) closeAuthModal(); });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('loginEmail').value;
      var password = document.getElementById('loginPassword').value;
      var result = window.LegendaryAuth.loginUser(email, password);
      if (result.error) {
        loginError.textContent = result.error;
        loginError.hidden = false;
        return;
      }
      closeAuthModal();
      loginForm.reset();
      renderAccountArea();
      afterAuthSuccess();
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('registerName').value;
      var email = document.getElementById('registerEmail').value;
      var password = document.getElementById('registerPassword').value;
      var result = window.LegendaryAuth.registerUser(name, email, password);
      if (result.error) {
        registerError.textContent = result.error;
        registerError.hidden = false;
        return;
      }
      closeAuthModal();
      registerForm.reset();
      renderAccountArea();
      afterAuthSuccess();
    });
  }

  function afterAuthSuccess() {
    if (pendingPlan) {
      var plan = pendingPlan;
      pendingPlan = null;
      handlePlanSelect(plan);
    }
  }

  // ---- Account dropdown ----
  function renderAccountArea() {
    var user = window.LegendaryAuth.currentUser();
    accountArea.innerHTML = '';
    if (!user) {
      var loginBtn = document.createElement('button');
      loginBtn.type = 'button';
      loginBtn.className = 'btn btn-outline account-login-btn';
      loginBtn.textContent = 'Đăng nhập';
      loginBtn.addEventListener('click', function () { openAuthModal('login'); });
      accountArea.appendChild(loginBtn);
      renderPricingState();
      return;
    }

    var menu = document.createElement('div');
    menu.className = 'account-menu';

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'account-trigger';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML =
      '<span class="account-avatar">' + escapeHtml((user.name || '?').charAt(0).toUpperCase()) + '</span>' +
      '<span class="account-name">' + escapeHtml(user.name) + '</span>' +
      '<span class="plan-chip plan-' + user.plan + '">' + PLAN_LABEL[user.plan] + '</span>';

    var dropdown = document.createElement('div');
    dropdown.className = 'account-dropdown';
    dropdown.innerHTML =
      '<p class="acc-email">' + escapeHtml(user.email) + '</p>' +
      '<p class="acc-plan-line">Gói hiện tại: <strong>' + PLAN_LABEL[user.plan] + '</strong></p>';

    var logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'btn btn-outline btn-sm';
    logoutBtn.textContent = 'Đăng xuất';
    logoutBtn.addEventListener('click', function () {
      window.LegendaryAuth.logoutUser();
      dropdown.classList.remove('open');
      renderAccountArea();
    });
    dropdown.appendChild(logoutBtn);

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = dropdown.classList.toggle('open');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    menu.appendChild(trigger);
    menu.appendChild(dropdown);
    accountArea.appendChild(menu);
    renderPricingState();
  }

  document.addEventListener('click', function (e) {
    var openDropdown = document.querySelector('.account-dropdown.open');
    if (openDropdown && !openDropdown.parentNode.contains(e.target)) {
      openDropdown.classList.remove('open');
    }
  });

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- Pricing card wiring ----
  function renderPricingState() {
    var user = window.LegendaryAuth.currentUser();
    var buttons = document.querySelectorAll('.plan-select-btn');
    buttons.forEach(function (btn) {
      var plan = btn.getAttribute('data-plan');
      var card = btn.closest('.price-card');
      var existingTag = card.querySelector('.price-current-tag');
      if (existingTag) existingTag.remove();
      if (user && user.plan === plan) {
        btn.disabled = true;
        btn.textContent = 'Đang dùng gói này';
        var tag = document.createElement('span');
        tag.className = 'price-current-tag';
        tag.textContent = 'Gói hiện tại';
        card.appendChild(tag);
      } else {
        btn.disabled = false;
        btn.textContent = btn.getAttribute('data-label') || btn.textContent;
      }
    });
  }

  function handlePlanSelect(plan) {
    var user = window.LegendaryAuth.currentUser();
    if (!user) {
      pendingPlan = plan;
      openAuthModal('login');
      return;
    }
    if (plan === 'free') {
      if (user.plan !== 'free') {
        window.LegendaryAuth.setUserPlan(user.id, 'free');
        renderAccountArea();
      }
      return;
    }
    openCheckout(plan);
  }

  document.querySelectorAll('.plan-select-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      handlePlanSelect(btn.getAttribute('data-plan'));
    });
  });

  // ---- Checkout modal (simulated MoMo payment) ----
  function openCheckout(plan) {
    checkoutPlan = plan;
    var info = PLAN_INFO[plan] || PLAN_INFO.pro;
    checkoutPlanName.textContent = info.name;
    checkoutPlanPrice.textContent = info.price;
    checkoutError.hidden = true;
    checkoutStatus.hidden = true;
    confirmPaymentBtn.disabled = false;
    confirmPaymentBtn.textContent = 'Xác nhận thanh toán (giả lập)';
    if (momoPhone) momoPhone.value = '';
    checkoutBackdrop.classList.add('open');
  }
  function closeCheckoutModal() {
    checkoutBackdrop.classList.remove('open');
  }
  if (closeCheckout) closeCheckout.addEventListener('click', closeCheckoutModal);
  if (checkoutBackdrop) {
    checkoutBackdrop.addEventListener('click', function (e) { if (e.target === checkoutBackdrop) closeCheckoutModal(); });
  }

  if (confirmPaymentBtn) {
    confirmPaymentBtn.addEventListener('click', function () {
      var phone = (momoPhone && momoPhone.value || '').trim();
      if (!/^0\d{9,10}$/.test(phone)) {
        checkoutError.textContent = 'Nhập số điện thoại MoMo hợp lệ (VD: 0901234567).';
        checkoutError.hidden = false;
        return;
      }
      checkoutError.hidden = true;
      var user = window.LegendaryAuth.currentUser();
      if (!user) { closeCheckoutModal(); openAuthModal('login'); return; }

      confirmPaymentBtn.disabled = true;
      confirmPaymentBtn.textContent = 'Đang xử lý…';
      checkoutStatus.hidden = false;
      checkoutStatus.textContent = 'Đang gửi yêu cầu thanh toán tới MoMo (giả lập)…';

      setTimeout(function () {
        var info = PLAN_INFO[checkoutPlan] || PLAN_INFO.pro;
        window.LegendaryAuth.setUserPlan(user.id, checkoutPlan);
        window.LegendaryAuth.recordOrder(user.id, checkoutPlan, info.price);
        checkoutStatus.textContent = '✓ Thanh toán thành công! Gói của bạn đã được nâng cấp lên ' + PLAN_LABEL[checkoutPlan] + '.';
        confirmPaymentBtn.textContent = 'Hoàn tất';
        renderAccountArea();
        setTimeout(closeCheckoutModal, 1400);
      }, 1500);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closeAuthModal();
    closeCheckoutModal();
  });

  renderAccountArea();
})();
