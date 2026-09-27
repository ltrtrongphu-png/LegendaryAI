(function(){
  'use strict';

  var MODEL_META = {
    free: { key:'legendary-lite-1', name:'LegendaryLite-1', plan:'FREE', desc:'Nhanh · chat · code cơ bản · tools', state:'Core local fallback' },
    pro: { key:'legendary-pro-1', name:'LegendaryPro-1', plan:'PRO', desc:'Reasoning · code · memory · vision*', state:'Pro core · self-host ready' },
    legendary: { key:'legendary-ultra-1', name:'LegendaryUltra-1', plan:'LEGENDARY', desc:'Reasoning sâu · long context · tools', state:'Ultra core · self-host ready' }
  };
  function el(tag, cls, text){ var n=document.createElement(tag); if(cls)n.className=cls; if(text!=null)n.textContent=text; return n; }
  function injectHeroExperience(){
    var visual=document.querySelector('.hero-visual'); var logo=document.querySelector('.legendary-3d-logo');
    if(!visual || !logo || visual.dataset.heroFxReady==='true') return; visual.dataset.heroFxReady='true';
    var img=logo.querySelector('.legendary-3d-logo-img');
    if(img){ for(var i=1;i<=7;i++){ var layer=img.cloneNode(true); layer.className='legendary-3d-depth depth-'+i; layer.setAttribute('aria-hidden','true'); logo.insertBefore(layer,img); } }
    logo.appendChild(el('div','legendary-logo-aura'));
    ['logo-orbit-a','logo-orbit-b','logo-orbit-c'].forEach(function(cls){ logo.appendChild(el('div','logo-orbit '+cls)); });
    var cards=[
      {cls:'code',icon:'</>',title:'Code',sub:'Build · Debug · Optimize',accent:'cyan'},
      {cls:'live',icon:'⚡',title:'Phản hồi theo thời gian thực',sub:'Low latency · Native core',accent:'blue'},
      {cls:'writing',icon:'▤',title:'Writing',sub:'Docs · Content · Publish',accent:'violet'},
      {cls:'vision',icon:'◫',title:'Vision',sub:'Image · Files · Create',accent:'cyan'},
      {cls:'reasoning',icon:'✦',title:'Reasoning',sub:'Context · Logic · Connect',accent:'violet'}
    ];
    var layer=el('div','hero-float-layer');
    cards.forEach(function(item){ var card=el('div','hero-float-card '+item.cls+' '+item.accent); card.appendChild(el('span','hero-card-icon',item.icon)); var copy=el('span','hero-card-copy'); copy.appendChild(el('strong','hero-card-title',item.title)); copy.appendChild(el('span','hero-card-sub',item.sub)); card.appendChild(copy); layer.appendChild(card); });
    visual.appendChild(layer);
  }
  function injectModelDock(){
    var chat=document.getElementById('chatApp'); var demo=document.getElementById('demo'); if(!chat || document.getElementById('legendaryModelDock')) return;
    var dock=el('div',''); dock.id='legendaryModelDock';
    Object.keys(MODEL_META).forEach(function(plan){ var m=MODEL_META[plan]; var card=el('article','la-model-card'); card.dataset.plan=plan; var top=el('div','la-model-top'); top.appendChild(el('strong','la-model-name',m.name)); top.appendChild(el('span','la-model-plan',m.plan)); card.appendChild(top); card.appendChild(el('p','la-model-desc',m.desc)); card.appendChild(el('div','la-model-state',m.state)); dock.appendChild(card); });
    var banner=el('div','la-engine-banner'); banner.appendChild(el('span','la-live-dot')); banner.appendChild(el('span','Native Engine · ')); banner.appendChild(el('b','', 'External AI providers disabled'));
    if(demo){ var head=demo.querySelector('.section-head'); if(head){ head.insertAdjacentElement('afterend',banner); head.insertAdjacentElement('afterend',dock); } }
  }
  function setPlanUI(profile){
    var plan=(profile&&profile.plan)||'free'; if(profile&&profile.role==='owner') plan='legendary';
    document.querySelectorAll('#legendaryModelDock .la-model-card').forEach(function(card){ card.dataset.active=card.dataset.plan===plan?'true':'false'; });
    var label=document.getElementById('chatModeLabel'); if(label){ var m=MODEL_META[plan]||MODEL_META.free; label.textContent='Legendary Engine · '+m.name; }
    document.querySelectorAll('[data-plan-card]').forEach(function(card){ card.classList.toggle('is-current',card.dataset.plan===plan); });
  }
  function updateClaims(){
    var textNodes=document.querySelectorAll('.stats .stat-lbl,.hero-trust .lbl'); textNodes.forEach(function(n){ if(/token/i.test(n.textContent)) n.textContent='token quota / cửa sổ'; if(/Thời gian hoạt động/i.test(n.textContent)) n.textContent='engine core'; if(/Sẵn sàng phục vụ/i.test(n.textContent)) n.textContent='mô hình lõi'; });
    var nums=document.querySelectorAll('.hero-trust .num'); if(nums.length>=3){ nums[0].textContent='6M'; nums[1].textContent='3'; nums[2].textContent='0'; nums[2].nextElementSibling.textContent='API AI bên ngoài'; }
  }

  function installPremiumControls(){
    if(document.getElementById('legendaryPremiumControls')) return;
    var form=document.getElementById('chatForm'); if(!form) return;
    var row=document.createElement('div'); row.id='legendaryPremiumControls'; row.className='la-premium-controls';
    var reasoning=document.createElement('button'); reasoning.type='button'; reasoning.id='reasoningToggle'; reasoning.className='la-reasoning-btn'; reasoning.setAttribute('aria-pressed','false');
    reasoning.innerHTML='<span class="la-reasoning-icon">✦</span><span>Suy luận</span><small id="reasoningTierLabel">Tắt</small>';
    reasoning.addEventListener('click',function(){
      var pressed=reasoning.getAttribute('aria-pressed')==='true';
      reasoning.setAttribute('aria-pressed',String(!pressed));
      reasoning.classList.toggle('active',!pressed);
      var label=document.getElementById('reasoningTierLabel');
      if(label) label.textContent=!pressed ? (window.__legendaryReasoningTierLabel||'Basic') : 'Tắt';
    });
    row.appendChild(reasoning);
    var badge=document.createElement('span'); badge.id='legendaryCapabilityBadge'; badge.className='la-capability-badge'; badge.textContent='Guest · 1K'; row.appendChild(badge);
    var anchor=form.querySelector('.chat-input-actions') || form.querySelector('.input-actions') || form;
    anchor.parentNode.insertBefore(row,anchor);
  }
  function updatePremiumControls(profile){
    var plan=(profile&&profile.plan)||'guest'; if(profile&&profile.role==='owner') plan='legendary';
    var tier=(window.LegendaryPlan&&window.LegendaryPlan.reasoningTier)?window.LegendaryPlan.reasoningTier(plan,profile&&profile.role):'none';
    window.__legendaryReasoningTierLabel={none:'Không khả dụng',basic:'Basic',deep:'Deep', 'deep-plus':'Deep+'}[tier]||'Basic';
    var badge=document.getElementById('legendaryCapabilityBadge'); if(badge){ badge.textContent=(plan==='guest'?'Guest · 1K':plan==='free'?'Free · 500K':plan==='pro'?'Pro · 2M':'Legendary · 6M'); }
    var btn=document.getElementById('reasoningToggle'); if(btn){ var enabled=tier!=='none'; btn.disabled=!enabled; btn.title=enabled?'Suy luận '+window.__legendaryReasoningTierLabel:'Đăng nhập để dùng Suy luận'; if(!enabled){btn.setAttribute('aria-pressed','false');btn.classList.remove('active');} var small=document.getElementById('reasoningTierLabel'); if(small&&!btn.classList.contains('active')) small.textContent=enabled?window.__legendaryReasoningTierLabel:'Tắt'; }
  }
  function installEngineBridge(){
    var attempts=0;
    function wrap(){
      if(!window.LegendaryAIEngine || typeof window.LegendaryAIEngine.chat!=='function'){ if(attempts++<80) setTimeout(wrap,250); return; }
      if(window.LegendaryAIEngine.chat.__legendaryWrapped) return;
      var original=window.LegendaryAIEngine.chat;
      var wrapped=async function(options){
        options=Object.assign({},options||{});
        var btn=document.getElementById('reasoningToggle');
        var reasoning=!!(btn&&btn.getAttribute('aria-pressed')==='true');
        options.reasoning=reasoning;
        options.reasoningTier=window.__legendaryReasoningTierLabel||'none';
        options.capability=reasoning?'reasoning':'';
        return original(options);
      };
      wrapped.__legendaryWrapped=true; window.LegendaryAIEngine.chat=wrapped;
    }
    wrap();
  }
  function boot(){
    injectHeroExperience(); injectModelDock(); updateClaims(); installPremiumControls(); installEngineBridge();
    var backend=window.LegendaryBackend;
    if(backend&&backend.getProfile){ backend.getProfile().then(function(p){setPlanUI(p);updatePremiumControls(p);}).catch(function(){setPlanUI(null);updatePremiumControls(null);}); }
    else { setPlanUI(null); updatePremiumControls(null); setTimeout(function(){ var b=window.LegendaryBackend; if(b&&b.getProfile)b.getProfile().then(function(p){setPlanUI(p);updatePremiumControls(p);}).catch(function(){}); },1200); }
    window.addEventListener('legendary:profile-ready',function(e){ var p=e&&e.detail?e.detail:null; setPlanUI(p);updatePremiumControls(p);installEngineBridge(); });
    window.addEventListener('legendary:auth-changed',function(){ setTimeout(function(){ if(window.LegendaryBackend&&window.LegendaryBackend.getProfile) window.LegendaryBackend.getProfile().then(function(p){setPlanUI(p);updatePremiumControls(p);}); installEngineBridge(); },100); });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot); else boot();
  window.LegendaryUIUpgrade={setPlanUI:setPlanUI,modelMeta:MODEL_META};
})();