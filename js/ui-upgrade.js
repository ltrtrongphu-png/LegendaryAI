(function(){
  'use strict';

  var MODEL_META = {
    free: {
      key:'legendary-lite-1',
      name:'LegendaryLite-1',
      plan:'FREE',
      desc:'Nhanh · chat · code cơ bản · tools',
      state:'Core local fallback'
    },
    pro: {
      key:'legendary-pro-1',
      name:'LegendaryPro-1',
      plan:'PRO',
      desc:'Reasoning · code · memory · vision*',
      state:'Pro core · self-host ready'
    },
    legendary: {
      key:'legendary-ultra-1',
      name:'LegendaryUltra-1',
      plan:'LEGENDARY',
      desc:'Reasoning sâu · long context · tools',
      state:'Ultra core · self-host ready'
    }
  };

  function el(tag, cls, text){
    var n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!=null)n.textContent=text;
    return n;
  }

  function injectHeroExperience(){
    var visual=document.querySelector('.hero-visual');
    var logo=document.querySelector('.legendary-3d-logo');
    if(!visual || !logo || visual.dataset.heroFxReady==='true') return;
    visual.dataset.heroFxReady='true';

    // Give the transparent atom mark real visual thickness while keeping the
    // original SVG as the front face. The depth layers rotate with it.
    var img=logo.querySelector('.legendary-3d-logo-img');
    if(img){
      for(var i=1;i<=7;i++){
        var layer=img.cloneNode(true);
        layer.className='legendary-3d-depth depth-'+i;
        layer.setAttribute('aria-hidden','true');
        logo.insertBefore(layer,img);
      }
    }

    var glow=el('div','legendary-logo-aura');
    logo.appendChild(glow);
    ['logo-orbit-a','logo-orbit-b','logo-orbit-c'].forEach(function(cls){
      logo.appendChild(el('div','logo-orbit '+cls));
    });

    var cards=[
      {cls:'code',icon:'</>',title:'Code',sub:'Build · Debug · Optimize',accent:'cyan'},
      {cls:'live',icon:'⚡',title:'Phản hồi theo thời gian thực',sub:'Low latency · Native core',accent:'blue'},
      {cls:'writing',icon:'▤',title:'Writing',sub:'Docs · Content · Publish',accent:'violet'},
      {cls:'vision',icon:'◫',title:'Vision',sub:'Image · Files · Create',accent:'cyan'},
      {cls:'reasoning',icon:'✦',title:'Reasoning',sub:'Context · Logic · Connect',accent:'violet'}
    ];

    var layer=el('div','hero-float-layer');
    cards.forEach(function(item){
      var card=el('div','hero-float-card '+item.cls+' '+item.accent);
      card.appendChild(el('span','hero-card-icon',item.icon));
      var copy=el('span','hero-card-copy');
      copy.appendChild(el('strong','hero-card-title',item.title));
      copy.appendChild(el('span','hero-card-sub',item.sub));
      card.appendChild(copy);
      layer.appendChild(card);
    });
    visual.appendChild(layer);
  }

  function injectModelDock(){
    var chat=document.getElementById('chatApp');
    var demo=document.getElementById('demo');
    if(!chat || document.getElementById('legendaryModelDock')) return;

    var dock=el('div','');
    dock.id='legendaryModelDock';

    Object.keys(MODEL_META).forEach(function(plan){
      var m=MODEL_META[plan];
      var card=el('article','la-model-card');
      card.dataset.plan=plan;
      var top=el('div','la-model-top');
      top.appendChild(el('strong','la-model-name',m.name));
      top.appendChild(el('span','la-model-plan',m.plan));
      card.appendChild(top);
      card.appendChild(el('p','la-model-desc',m.desc));
      card.appendChild(el('div','la-model-state',m.state));
      dock.appendChild(card);
    });

    var banner=el('div','la-engine-banner');
    banner.appendChild(el('span','la-live-dot'));
    banner.appendChild(el('span','Native Engine · '));
    banner.appendChild(el('b','', 'External AI providers disabled'));

    if(demo){
      var head=demo.querySelector('.section-head');
      if(head){ head.insertAdjacentElement('afterend',banner); head.insertAdjacentElement('afterend',dock); }
    }
  }

  function setPlanUI(profile){
    var plan=(profile&&profile.plan)||'free';
    if(profile&&profile.role==='owner') plan='legendary';

    document.querySelectorAll('#legendaryModelDock .la-model-card').forEach(function(card){
      card.dataset.active=card.dataset.plan===plan?'true':'false';
    });

    var label=document.getElementById('chatModeLabel');
    if(label){
      var m=MODEL_META[plan]||MODEL_META.free;
      label.textContent='Legendary Engine · '+m.name;
    }

    document.querySelectorAll('[data-plan-card]').forEach(function(card){
      card.classList.toggle('is-current',card.dataset.plan===plan);
    });
  }

  function updateClaims(){
    var textNodes=document.querySelectorAll('.stats .stat-lbl,.hero-trust .lbl');
    textNodes.forEach(function(n){
      if(/token/i.test(n.textContent)) n.textContent='token quota / cửa sổ';
      if(/Thời gian hoạt động/i.test(n.textContent)) n.textContent='engine core';
      if(/Sẵn sàng phục vụ/i.test(n.textContent)) n.textContent='mô hình lõi';
    });
    var nums=document.querySelectorAll('.hero-trust .num');
    if(nums.length>=3){
      nums[0].textContent='6M';
      nums[1].textContent='3';
      nums[2].textContent='0';
      nums[2].nextElementSibling.textContent='API AI bên ngoài';
    }
  }

  function boot(){
    injectHeroExperience();
    injectModelDock();
    updateClaims();
    var backend=window.LegendaryBackend;
    if(backend&&backend.getProfile){
      backend.getProfile().then(setPlanUI).catch(function(){setPlanUI(null);});
    } else {
      setPlanUI(null);
      setTimeout(function(){
        var b=window.LegendaryBackend;
        if(b&&b.getProfile)b.getProfile().then(setPlanUI).catch(function(){});
      },1200);
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
  else boot();

  window.LegendaryUIUpgrade={setPlanUI:setPlanUI,modelMeta:MODEL_META};
})();