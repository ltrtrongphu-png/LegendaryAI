import assert from 'node:assert/strict';

const LIMITS = { guest: 1000, free: 500000, pro: 2000000, legendary: 6000000 };
const REASONING = { guest: 'none', free: 'basic', pro: 'deep', legendary: 'deep-plus' };
const CAPS = {
  free: { reasoning: true, projectWorkspace: false, vision: false, memory: false, agentMode: false },
  pro: { reasoning: true, projectWorkspace: true, vision: true, memory: true, agentMode: false },
  legendary: { reasoning: true, projectWorkspace: true, vision: true, memory: true, agentMode: true },
};

assert.equal(LIMITS.guest, 1000);
assert.equal(LIMITS.free, 500000);
assert.equal(LIMITS.pro, 2000000);
assert.equal(LIMITS.legendary, 6000000);
assert.equal(REASONING.free, 'basic');
assert.equal(REASONING.pro, 'deep');
assert.equal(REASONING.legendary, 'deep-plus');
assert.equal(CAPS.pro.projectWorkspace, true);
assert.equal(CAPS.legendary.agentMode, true);
console.log('plan capability tests passed');
