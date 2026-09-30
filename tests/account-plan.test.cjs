const { test } = require('node:test'), assert = require('node:assert/strict');
test('subscription labels retain authoritative plan and Max tier without inferring from usage', async () => {
  const { accountPlan } = await import('../src/account-plan.mjs');
  const a = (plan, tier) => ({ profile: { fields: [{ id: 'plan', value: plan }, { id: 'tier', value: tier }] } });
  assert.equal(accountPlan(a('max', 'default_claude_max_5x')), 'Max 5×');
  assert.equal(accountPlan(a('max', 'default_claude_max_20x')), 'Max 20×');
  assert.equal(accountPlan(a('max', 'unknown')), 'Max'); assert.equal(accountPlan(a('plus')), 'Plus');
  assert.equal(accountPlan(a('pro')), 'Pro'); assert.equal(accountPlan({}), '');
});
