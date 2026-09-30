const plans = { free: 'Free', plus: 'Plus', pro: 'Pro', max: 'Max', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu',
  pro5x: 'Pro 5×', pro20x: 'Pro 20×', max5x: 'Max 5×', max20x: 'Max 20×', max_5x: 'Max 5×', max_20x: 'Max 20×' };
export function accountPlan(account) {
  const fields = [...(account?.quota?.fields || []), ...(account?.profile?.fields || [])];
  const get = (id) => fields.find((f) => f.id === id)?.value;
  const plan = get('plan'), tier = get('tier');
  if (!plan) return '';
  // Only explicit native entitlement tiers. Do not infer 5x/20x from usage.
  if (String(plan).toLowerCase() === 'max' && /^default_claude_max_(5|20)x$/.test(tier || '')) return 'Max ' + tier.match(/(5|20)x$/)[1] + '×';
  return plans[String(plan).toLowerCase()] || String(plan);
}
