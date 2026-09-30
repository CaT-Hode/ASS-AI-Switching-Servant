// Classify the quota window, never the supplier name or the remaining value.
export function quotaPeriod(field) {
  const id = String(field?.id || '').toLowerCase(), label = String(field?.label || '').toLowerCase();
  if (/month/.test(id) || /月|\bmonthly\b|\bmonth\b/.test(label)) return 'month';
  if (/weekly|seven_day|7d/.test(id) || /周|\bweekly\b|\bweek\b/.test(label)) return 'week';
  if (/five_hour|5h|rolling/.test(id) || /(?:^|[^0-9])5\s*(?:h\b|小时)/.test(label)) return 'short';
  return 'other';
}
