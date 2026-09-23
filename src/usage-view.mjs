export const CLIENT_NAMES = {
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
  pi: "pi",
  dsh: "DSH",
  kimi: "Kimi Code",
  zcode: "ZCode",
  antigravity: "Antigravity",
};
export const detectedClients = (state) => state.harnesses.clients.filter((c) =>
  c.detected === true || (c.detected === undefined && !!(c.executable || c.launcher?.installed || c.desktop)));
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
export function summarize(rows, options, now = new Date()) {
  const bounds = rangeBounds(options.range, now),
    total = empty(),
    days = new Map(),
    hours = new Map(),
    dailyOnly = new Map(),
    unallocated = empty(),
    groups = new Map();
  const periodHours =
    options.range === "week" ? 1 : options.range === "month" ? 4 : 24;
  const grain = periodHours < 24 ? "hour" : "day";
  const hourKey = (day, hour) => `${day}T${String(hour).padStart(2, "0")}`;
  for (const r of rows) {
    const hasHour = Number.isInteger(r.hour) && r.hour >= 0 && r.hour < 24;
    if (
      r.day < bounds.from ||
      r.day > bounds.to ||
      (options.client !== "all" && r.client !== options.client) ||
      (r.day === bounds.to && hasHour && r.hour > now.getHours())
    )
      continue;
    add(total, r);
    const day = days.get(r.day) || empty();
    add(day, r);
    days.set(r.day, day);
    if (grain === "hour") {
      if (hasHour) {
        const key = hourKey(
            r.day,
            Math.floor(r.hour / periodHours) * periodHours,
          ),
          bucket = hours.get(key) || empty();
        add(bucket, r);
        hours.set(key, bucket);
      } else {
        const bucket = dailyOnly.get(r.day) || empty();
        add(bucket, r);
        add(unallocated, r);
        dailyOnly.set(r.day, bucket);
      }
    }
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
  ) {
    const day = dayKey(d);
    if (grain === "day")
      timeline.push({ key: day, day, ...(days.get(day) || empty()) });
    else {
      const lastHour = day === bounds.to ? now.getHours() : 23;
      for (let hour = 0; hour <= lastHour; hour += periodHours) {
        const key = hourKey(day, hour);
        timeline.push({
          key,
          day,
          hour,
          label: `${day} ${String(hour).padStart(2, "0")}:00–${String(hour + periodHours).padStart(2, "0")}:00`,
          ...(hours.get(key) || empty()),
        });
      }
    }
  }
  return {
    ...bounds,
    range: options.range,
    grain,
    periodHours,
    total,
    timeline,
    unallocated,
    dailyOnly: [...dailyOnly]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, value]) => ({
        key: day + "-daily",
        day,
        label: day + " · 仅按日记录",
        ...value,
      })),
    groups: [...groups.values()].sort(
      (a, b) => b.input + b.output - (a.input + a.output),
    ),
  };
}
export function overviewAccounts(state, clientFilter) {
  const accounts = new Map();
  for (const client of detectedClients(state)) {
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
