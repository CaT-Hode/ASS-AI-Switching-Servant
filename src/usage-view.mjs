export const CLIENT_NAMES = {
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
  pi: "pi",
  dsh: "DSH",
};
export const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function rangeBounds(range, now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    start = new Date(end);
  if (range === "week")
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else if (range === "year") start.setDate(start.getDate() - 364);
  else start.setDate(1);
  return { from: dayKey(start), to: dayKey(end), start, end };
}
const empty = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  calls: 0,
  sessions: new Set(),
  observations: 0,
});
function add(to, row) {
  for (const k of [
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "reasoning",
    "calls",
  ])
    to[k] += row[k] || 0;
  for (const s of row.sessions || []) to.sessions.add(s);
  to.observations++;
}
export function summarize(rows, options, now) {
  const bounds = rangeBounds(options.range, now),
    total = empty(),
    days = new Map(),
    groups = new Map();
  for (const r of rows) {
    if (
      r.day < bounds.from ||
      r.day > bounds.to ||
      (options.client !== "all" && r.client !== options.client)
    )
      continue;
    add(total, r);
    const day = days.get(r.day) || empty();
    add(day, r);
    days.set(r.day, day);
    const name =
      options.group === "model" ? r.model : CLIENT_NAMES[r.client] || r.client;
    const group = groups.get(name) || { name, ...empty() };
    add(group, r);
    groups.set(name, group);
  }
  const timeline = [];
  for (
    let d = new Date(bounds.start);
    d <= bounds.end;
    d.setDate(d.getDate() + 1)
  )
    timeline.push({ day: dayKey(d), ...(days.get(dayKey(d)) || empty()) });
  return {
    ...bounds,
    total,
    timeline,
    groups: [...groups.values()].sort(
      (a, b) => b.input + b.output - (a.input + a.output),
    ),
  };
}
export function overviewAccounts(state, clientFilter) {
  const accounts = new Map();
  for (const client of state.harnesses.clients) {
    if (clientFilter !== "all" && client.id !== clientFilter) continue;
    for (const a of client.accounts) {
      if (
        !a.ready &&
        a.kind !== "api" &&
        !["expired", "refresh-required"].includes(a.status)
      )
        continue;
      // The same bound API key in several clients has one shared balance.
      const key =
        a.kind === "api" ? "api:" + a.providerId : client.id + ":" + a.id;
      if (accounts.has(key)) {
        accounts.get(key).clients.push(client.name);
        continue;
      }
      const fields = a.profile?.fields || [],
        quota = a.quota || a.profile;
      const get = (id) => fields.find((f) => f.id === id)?.value;
      const balance = state.balances?.[a.providerId];
      const amounts = fields.filter(
        (f) => f.id.startsWith("balance-") || f.id === "remaining",
      );
      accounts.set(key, {
        key,
        account: a,
        client,
        clients: [client.name],
        name: get("email") || get("name") || a.label,
        plan: get("plan"),
        quotas: (quota?.fields || []).filter((f) => f.kind === "quota"),
        amounts: amounts.length
          ? amounts
          : balance?.ok
            ? (balance.rows || [balance]).map((f, i) => ({
                ...f,
                id: "balance-" + i,
              }))
            : [],
        updatedAt: quota?.updatedAt,
        error: quota?.error,
        canRefresh: quota?.canRefresh || a.profile?.canRefresh,
      });
    }
  }
  return [...accounts.values()];
}
