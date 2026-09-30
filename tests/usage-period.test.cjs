const { test } = require('node:test'), assert = require('node:assert/strict');
test('quota colors follow known window metadata, never supplier names or percentages', async () => {
  const { quotaPeriod } = await import('../src/usage-period.mjs');
  for (const field of [{ id: 'quota-five_hour' }, { id: 'quota-limit_5h' }, { id: 'quota-rolling' }, { label: '5h' }, { label: '工具 · 5小时' }]) assert.equal(quotaPeriod(field), 'short');
  for (const field of [{ id: 'quota-seven_day' }, { id: 'quota-limit_7d' }, { id: 'quota-weekly' }, { label: '周' }, { label: '每周额度' }]) assert.equal(quotaPeriod(field), 'week');
  for (const field of [{ id: 'quota-monthly' }, { id: 'quota-limit_month_code' }, { label: '月' }, { label: '月度总额度' }]) assert.equal(quotaPeriod(field), 'month');
  for (const field of [undefined, {}, { id: 'quota-0', label: '窗口 1', provider: '月亮', remainingPercent: 5 }, { label: '15h' }]) assert.equal(quotaPeriod(field), 'other');
});
