(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Hero V8 is loaded declaratively from index.html; no legacy hero-3d runtime stylesheet is injected.
  // ---------------------------------------------------------------------
  // Chat image-routing hotfix
  // The legacy chat.js classifier can be served from an older cached build.
  // Capture image requests here so they always reach the real image provider.
  // ---------------------------------------------------------------------
  function isImageGenerationPrompt(text) {
    var x = String(text || '').trim().toLowerCase();
    if (!x) return false;
    if (/(?:^|\s)(?:vẽ|draw)(?:\s|$)/i.test(x)) return true;
    return /(?:^|\s)(?:tạo|generate|create)(?:\s|$)/i.test(x) &&
      /(?:ảnh|hình|image|picture|illustration|art|wallpaper|avatar|logo|poster|thumbnail|photo|meme)/i.test(x);
  }

  function escapeImageAlt(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function installImageRoutingHotfix() {
    var form = document.getElementById('chatForm');
    var input = document.getElementById('chatInput');
    var windowEl = document.getElementById('chatWindow');
    if (!form || !input || !windowEl || !window.LegendaryAIEngine) return;
    if (form.dataset.legendaryImageRoutingHotfix === '1') return;
    form.dataset.legendaryImageRoutingHotfix = '1';

    form.addEventListener('submit', function (event) {
      var prompt = String(input.value || '').trim();
      if (!isImageGenerationPrompt(prompt)) return;

      // Stop chat.js before it sends the prompt to the text AI endpoint.
      event.preventDefault();
      event.stopImmediatePropagation();

      var userWrap = document.createElement('div');
      userWrap.className = 'msg msg-user';
      var userBubble = document.createElement('div');
      userBubble.className = 'msg-bubble';
      userBubble.textContent = prompt;
      userWrap.appendChild(userBubble);
      windowEl.appendChild(userWrap);

      input.value = '';
      var aiWrap = document.createElement('div');
      aiWrap.className = 'msg msg-ai';
      var avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      avatar.textContent = 'L';
      var bubble = document.createElement('div');
      bubble.className = 'msg-bubble typing';
      bubble.textContent = 'Đang tạo ảnh…';
      aiWrap.appendChild(avatar);
      aiWrap.appendChild(bubble);
      windowEl.appendChild(aiWrap);
      windowEl.scrollTop = windowEl.scrollHeight;

      var controller = new AbortController();
      window.LegendaryAIEngine.image({
        prompt: prompt,
        size: 'auto',
        quality: 'auto',
        background: 'auto',
        signal: controller.signal
      })
        .then(function (result) {
          var dataUrl = result && result.imageDataUrl;
          if (!dataUrl) throw new Error('Image Provider không trả về ảnh.');

          bubble.classList.remove('typing');
          bubble.innerHTML =
            '<div class="generated-image-wrap">' +
            '<img class="generated-image" src="' + dataUrl + '" alt="' + escapeImageAlt(prompt) + '">' +
            '<div class="generated-image-meta">GPT Image 2 · Image Provider</div>' +
            '</div>';
          windowEl.scrollTop = windowEl.scrollHeight;
        })
        .catch(function (error) {
          bubble.classList.remove('typing');
          bubble.classList.add('error');
          bubble.textContent = 'Không thể tạo ảnh: ' + (error && error.message ? error.message : String(error));
        });
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installImageRoutingHotfix, { once: true });
  } else {
    installImageRoutingHotfix();
  }

  // ---- Mobile nav ----
  var navToggle = document.getElementById('navToggle');
  var mainNav = document.getElementById('mainNav');
  if (navToggle && mainNav) {
    navToggle.addEventListener('click', function () {
      var open = mainNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    mainNav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        mainNav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ---- Theme toggle (persisted) ----
  var THEME_KEY = 'legendaryai_theme';
  var themeToggle = document.getElementById('themeToggle');
  var root = document.documentElement;
  function applyTheme(theme) {
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
      if (themeToggle) themeToggle.textContent = '☀️';
    } else {
      root.removeAttribute('data-theme');
      if (themeToggle) themeToggle.textContent = '🌙';
    }
  }
  var savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
  applyTheme(savedTheme);
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    });
  }

  // ---- Scroll-spy for nav links ----
  var navLinks = mainNav ? Array.prototype.slice.call(mainNav.querySelectorAll('a[href^="#"]')) : [];
  var sections = navLinks
    .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
    .filter(Boolean);
  if (sections.length && 'IntersectionObserver' in window) {
    var spyObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = navLinks.filter(function (a) { return a.getAttribute('href') === '#' + entry.target.id; })[0];
        if (!link) return;
        if (entry.isIntersecting) {
          navLinks.forEach(function (a) { a.classList.remove('active'); });
          link.classList.add('active');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    sections.forEach(function (s) { spyObserver.observe(s); });
  }

  // ---- Reveal-on-scroll ----
  var revealEls = document.querySelectorAll('.reveal, .reveal-stagger');
  if (revealEls.length) {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('in-view'); });
    } else {
      var revealObserver = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });
      revealEls.forEach(function (el) { revealObserver.observe(el); });
    }
  }

  // ---- Animate the capacity ring once it scrolls into view ----
  var meterFill = document.getElementById('meterFill');
  var capacitySection = document.getElementById('capacity');
  if (meterFill && capacitySection && 'IntersectionObserver' in window) {
    var circumference = 2 * Math.PI * 86;
    var meterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          meterFill.style.strokeDashoffset = (circumference * 0.06).toFixed(1);
          meterObserver.disconnect();
        }
      });
    }, { threshold: 0.4 });
    meterObserver.observe(capacitySection);
  }

  // ---- Animated stat counters ----
  var statEls = document.querySelectorAll('.stat-num[data-count]');
  if (statEls.length) {
    var runCount = function (el) {
      var target = parseFloat(el.getAttribute('data-count')) || 0;
      var suffix = el.getAttribute('data-suffix') || '';
      if (reduceMotion) {
        el.textContent = target.toLocaleString('vi-VN') + suffix;
        return;
      }
      var start = null;
      var duration = 1400;
      function step(ts) {
        if (!start) start = ts;
        var progress = Math.min((ts - start) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        var current = Math.round(target * eased);
        el.textContent = current.toLocaleString('vi-VN') + suffix;
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    };
    if ('IntersectionObserver' in window) {
      var statObserver = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            runCount(entry.target);
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.5 });
      statEls.forEach(function (el) { statObserver.observe(el); });
    } else {
      statEls.forEach(runCount);
    }
  }

  // ---- Back to top ----
  var backToTop = document.getElementById('backToTop');
  if (backToTop) {
    window.addEventListener('scroll', function () {
      backToTop.classList.toggle('show', window.scrollY > 480);
    }, { passive: true });
    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  // ---- Only one FAQ item open at a time ----
  var faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(function (item) {
    item.addEventListener('toggle', function () {
      if (item.open) {
        faqItems.forEach(function (other) {
          if (other !== item) other.open = false;
        });
      }
    });
  });
})();
