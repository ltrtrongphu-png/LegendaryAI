(function () {
  'use strict';

  var CAPS = {
    guest: { reasoning: false, projectWorkspace: false, vision: false, memory: false, agentMode: false, batchTasks: false, multiModel: false },
    free: { reasoning: true, projectWorkspace: false, vision: false, memory: false, agentMode: false, batchTasks: false, multiModel: false },
    pro: { reasoning: true, projectWorkspace: true, vision: true, memory: true, agentMode: false, batchTasks: true, multiModel: false },
    legendary: { reasoning: true, projectWorkspace: true, vision: true, memory: true, agentMode: true, batchTasks: true, multiModel: true }
  };
  var LIMITS = { guest: 1000, free: 500000, pro: 2000000, legendary: 6000000 };
  var REASONING = { guest: 'none', free: 'basic', pro: 'deep', legendary: 'deep-plus' };

  function normalizePlan(plan, role) {
    if (role === 'owner') return 'legendary';
    plan = String(plan || 'guest').toLowerCase();
    return CAPS[plan] ? plan : 'guest';
  }

  function setCatalog(plans) {
    (Array.isArray(plans) ? plans : []).forEach(function (p) {
      var key = String(p.key || '').toLowerCase();
      if (!key) return;
      CAPS[key] = p.capabilities && typeof p.capabilities === 'object' ? p.capabilities : {};
      LIMITS[key] = Number(p.token_limit || LIMITS[key] || 1000);
      REASONING[key] = String(p.reasoning_tier || REASONING[key] || 'none');
    });
    window.LegendaryPlan.capabilities = CAPS;
  }

  window.LegendaryPlan = {
    capabilities: CAPS,
    tokenLimit: function (plan, role) { return LIMITS[normalizePlan(plan, role)] || 1000; },
    reasoningTier: function (plan, role) { return REASONING[normalizePlan(plan, role)] || 'none'; },
    normalize: normalizePlan,
    setCatalog: setCatalog,
    can: function (plan, capability, role) {
      var key = normalizePlan(plan, role);
      return !!(CAPS[key] && CAPS[key][capability]);
    }
  };
})();
