export function orderProviders(providers, order = []) {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...providers].sort(
    (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity),
  );
}
export function moveVisible(allIds, visibleIds, from, to) {
  const ids = visibleIds.filter((id) => allIds.includes(id));
  if (!ids.includes(from) || !ids.includes(to) || from === to) return allIds;
  const changed = [...ids];
  changed.splice(changed.indexOf(from), 1);
  changed.splice(ids.indexOf(to), 0, from);
  const visible = new Set(ids);
  let index = 0;
  return allIds.map((id) => (visible.has(id) ? changed[index++] : id));
}
