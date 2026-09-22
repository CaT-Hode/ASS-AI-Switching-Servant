// Read-only local usage readers. Never retain prompts, paths, keys or account IDs
// in the renderer snapshot. All native input formats normalize input INCLUDING
// cache reads/writes; reasoning is a subset of output, never an extra charge.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { nativeLocations } = require("./credential-status.cjs");
const CLIENTS = ["codex", "claude", "opencode", "pi", "dsh"];
const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
const num = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
const known = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const label = (v) =>
  typeof v === "string" && v.length <= 200 && !/[\x00-\x1f]/.test(v)
    ? v
    : "未标注";
function dayKey(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : "";
}
function localHour(value) {
  // Date-only ledgers have no time precision; midnight is not an observation.
  if (
    value == null ||
    (typeof value === "string" && !/[T ]\d{2}:\d{2}/.test(value))
  )
    return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getHours() : null;
}
function normalized(
  input,
  output,
  cacheRead,
  cacheWrite,
  reasoning,
  includesCache = false,
) {
  cacheRead = num(cacheRead);
  cacheWrite = num(cacheWrite);
  input = num(input) + (includesCache ? 0 : cacheRead + cacheWrite);
  return {
    input,
    output: num(output),
    cacheRead: Math.min(input, cacheRead),
    cacheWrite: Math.min(Math.max(0, input - cacheRead), cacheWrite),
    reasoning: Math.min(num(output), num(reasoning)),
  };
}
function codexUsage(u) {
  return normalized(
    u.input_tokens,
    u.output_tokens,
    u.cached_input_tokens,
    u.cache_write_input_tokens,
    u.reasoning_output_tokens,
    true,
  );
}
function parser(client, fileKey) {
  let model = "未标注",
    provider = "未标注",
    session = fileKey,
    previous,
    created = 0;
  const rows = new Map();
  function put(key, time, usage, extra = {}) {
    const day = dayKey(time);
    if (!day || !usage) return;
    rows.set(key, {
      key: hash(client + "\0" + key),
      client,
      day,
      hour: localHour(time),
      session: hash(client + "\0" + session),
      model: label(model),
      provider: label(provider),
      calls: 1,
      ...usage,
      ...extra,
    });
  }
  return {
    rows,
    accept(x) {
      if (client === "codex") {
        if (x.type === "session_meta") {
          session = x.payload?.id || session;
          provider = x.payload?.model_provider || provider;
          created = Date.parse(x.payload?.timestamp) || 0;
        }
        if (x.type === "turn_context") model = x.payload?.model || model;
        if (
          x.type !== "event_msg" ||
          x.payload?.type !== "token_count" ||
          !x.payload.info?.total_token_usage
        )
          return;
        const reported = x.payload.info.total_token_usage;
        if (!known(reported.input_tokens) || !known(reported.output_tokens))
          return;
        const total = codexUsage(reported),
          last = x.payload.info.last_token_usage;
        const signature = JSON.stringify(total);
        if (previous?.signature === signature) return;
        // Seeded/forked histories must not count their inherited cumulative total.
        let delta = last ? codexUsage(last) : total;
        if (
          previous &&
          total.input >= previous.total.input &&
          total.output >= previous.total.output
        ) {
          delta = Object.fromEntries(
            Object.keys(total).map((k) => [
              k,
              Math.max(0, total[k] - previous.total[k]),
            ]),
          );
          delta.cacheRead = Math.min(delta.input, delta.cacheRead);
          delta.cacheWrite = Math.min(
            delta.input - delta.cacheRead,
            delta.cacheWrite,
          );
          delta.reasoning = Math.min(delta.output, delta.reasoning);
        }
        previous = { signature, total };
        if (created && Date.parse(x.timestamp) < created) return;
        if (delta.input + delta.output === 0) return;
        put(
          session + "\0" + x.timestamp + "\0" + signature,
          x.timestamp,
          delta,
        );
      } else if (client === "claude") {
        if (x.type !== "assistant" || !x.message?.usage || !x.message.id)
          return;
        const m = x.message,
          u = m.usage;
        if (!known(u.input_tokens) || !known(u.output_tokens)) return;
        model = m.model;
        provider = "anthropic";
        session = x.sessionId || session;
        // Streaming revisions of the same message replace, not add, usage.
        put(
          m.id,
          x.timestamp,
          normalized(
            u.input_tokens,
            u.output_tokens,
            u.cache_read_input_tokens,
            u.cache_creation_input_tokens,
            0,
          ),
        );
      } else if (client === "pi") {
        if (x.type === "session") {
          session = x.id || session;
          created = Date.parse(x.timestamp) || 0;
        }
        const m = x.message;
        if (
          x.type !== "message" ||
          m?.role !== "assistant" ||
          !m.usage ||
          !x.id
        )
          return;
        if (created && Date.parse(x.timestamp) < created) return;
        model = m.model;
        provider = m.provider;
        const u = m.usage;
        if (!known(u.input) || !known(u.output)) return;
        put(
          x.id,
          x.timestamp || m.timestamp,
          normalized(u.input, u.output, u.cacheRead, u.cacheWrite, 0),
        );
      }
    },
  };
}
async function readJsonl(file, client, fileKey) {
  const reader = parser(client, fileKey);
  let pending = "",
    oversized = false,
    malformed = 0;
  const wanted =
    client === "codex"
      ? /"(?:token_count|turn_context|session_meta)"/
      : /"(?:assistant|session)"/;
  for await (const chunk of fs.createReadStream(file, {
    encoding: "utf8",
    highWaterMark: 256 * 1024,
  })) {
    pending += chunk;
    let cut;
    while ((cut = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, cut);
      pending = pending.slice(cut + 1);
      if (!oversized && wanted.test(line)) {
        try {
          reader.accept(JSON.parse(line));
        } catch {
          malformed++;
        }
      }
      oversized = false;
    }
    // Tool output can be arbitrarily large; no need to parse that content.
    if (pending.length > 8 * 1024 * 1024) {
      pending = "";
      oversized = true;
      malformed++;
    }
  }
  if (pending.trim() && !oversized && wanted.test(pending)) {
    try {
      reader.accept(JSON.parse(pending));
    } catch {
      /* a live append may be incomplete */
    }
  }
  return { rows: [...reader.rows.values()], malformed };
}
function readOpenCode(file) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    // Only usage metadata, never message text or tool parts, crosses SQLite.
    const q = db.prepare(`SELECT m.id, m.session_id,
      COALESCE(json_extract(m.data,'$.time.created'),m.time_created) AS time_created,
      s.time_created AS session_created,
      json_extract(m.data,'$.modelID') AS model, json_extract(m.data,'$.providerID') AS provider,
      json_extract(m.data,'$.tokens') AS usage FROM message m JOIN session s ON s.id=m.session_id
      WHERE json_valid(m.data) AND json_extract(m.data,'$.role')='assistant'`);
    const rows = [];
    for (const x of q.iterate()) {
      if (!x.usage || x.time_created < x.session_created) continue;
      const u = JSON.parse(x.usage);
      if (!known(u.input) || !known(u.output)) continue;
      rows.push({
        key: hash("opencode\0" + x.id),
        client: "opencode",
        day: dayKey(x.time_created),
        hour: localHour(x.time_created),
        session: hash("opencode\0" + x.session_id),
        model: label(x.model),
        provider: label(x.provider),
        calls: 1,
        ...normalized(
          u.input,
          num(u.output) + num(u.reasoning),
          u.cache?.read,
          u.cache?.write,
          u.reasoning,
        ),
      });
    }
    return { rows, malformed: 0 };
  } finally {
    db.close();
  }
}
function readDsh(file) {
  if (fs.statSync(file).size > 32 * 1024 * 1024)
    throw Error("ledger-too-large");
  const data = JSON.parse(fs.readFileSync(file, "utf8")),
    rows = [];
  if (data.version == null || !data.days || typeof data.days !== "object")
    throw Error("ledger-format");
  for (const [day, d] of Object.entries(data.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const groups = Object.entries(d.byProviderModel || {});
    for (const [key, u] of groups.length ? groups : [["未标注", d]]) {
      const split = key.indexOf(":"),
        provider = split < 0 ? "未标注" : key.slice(0, split),
        model = split < 0 ? key : key.slice(split + 1);
      if (!known(u.input) || !known(u.output)) continue;
      rows.push({
        key: hash("dsh\0" + file + "\0" + day + "\0" + key),
        client: "dsh",
        day,
        hour: null,
        model: label(model),
        provider: label(provider),
        calls: num(u.calls),
        ...normalized(
          u.input,
          u.output,
          u.cacheRead,
          u.cacheWrite,
          u.reasoning,
        ),
        sessions: Array.isArray(d.sessions)
          ? d.sessions
              .filter((s) => !groups.length || s.byProviderModel?.[key])
              .map((s) => hash("dsh\0" + s.id))
          : [],
      });
    }
  }
  return { rows, malformed: 0 };
}
function filesUnder(dir, found, depth = 0, status) {
  if (depth > 12 || found.length >= 5000) {
    status.partial = true;
    return;
  }
  let list;
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code !== "ENOENT") status.partial = true;
    return;
  }
  for (const e of list) {
    if (e.isSymbolicLink()) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) filesUnder(f, found, depth + 1, status);
    else if (e.isFile() && e.name.endsWith(".jsonl")) found.push(f);
    if (found.length >= 5000) {
      status.partial = true;
      break;
    }
  }
}
function rootsFor(client, options) {
  const dirs = nativeLocations(
    client,
    options.home,
    options.env,
    options.overrides?.[client],
    options.codexDir,
  );
  for (const p of options.profiles || [])
    if (p.harness === client)
      dirs.push(path.join(options.dataDir, "clients", client, p.id));
  return [...new Set(dirs)];
}
async function scan(options, previousCache = {}) {
  const cache = {},
    records = new Map(),
    sources = [];
  const now = options.now || Date.now(),
    earliest = new Date(now);
  earliest.setDate(earliest.getDate() - 364);
  const from = dayKey(earliest),
    to = dayKey(now);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let bytes = 0;
  for (const client of CLIENTS) {
    const source = {
      client,
      files: 0,
      records: 0,
      partial: false,
      status: "empty",
      format:
        client === "dsh"
          ? "DSH cost-meter 日账本"
          : client === "opencode"
            ? "OpenCode SQLite"
            : "本机会话 JSONL",
    };
    const files = [];
    for (const dir of rootsFor(client, options)) {
      if (client === "opencode") files.push(path.join(dir, "opencode.db"));
      else if (client === "dsh")
        files.push(path.join(dir, "storages/cost-meter/ledger.json"));
      else if (client === "codex") {
        filesUnder(path.join(dir, "sessions"), files, 0, source);
        filesUnder(path.join(dir, "archived_sessions"), files, 0, source);
      } else
        filesUnder(
          path.join(dir, client === "claude" ? "projects" : "sessions"),
          files,
          0,
          source,
        );
    }
    for (const file of new Set(files)) {
      let stat;
      try {
        stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
      } catch (e) {
        if (e.code !== "ENOENT") source.partial = true;
        continue;
      }
      source.files++;
      const key = hash(client + "\0" + file),
        wal =
          client === "opencode" &&
          (() => {
            try {
              return fs.statSync(file + "-wal");
            } catch {
              return null;
            }
          })();
      const signature = [
        2,
        timeZone,
        stat.size,
        stat.mtimeMs,
        wal?.size,
        wal?.mtimeMs,
      ].join(":");
      try {
        let entry = previousCache[key];
        if (entry?.signature !== signature) {
          bytes += stat.size;
          if (bytes > 3 * 1024 ** 3) {
            source.partial = true;
            continue;
          }
          entry = {
            signature,
            ...(client === "opencode"
              ? readOpenCode(file)
              : client === "dsh"
                ? readDsh(file)
                : await readJsonl(file, client, key)),
          };
        }
        cache[key] = entry;
        if (entry.malformed) source.partial = true;
        for (const row of entry.rows)
          if (row.day >= from && row.day <= to) records.set(row.key, row);
      } catch {
        source.partial = true;
      }
    }
    source.records = [...records.values()].filter(
      (r) => r.client === client,
    ).length;
    source.status = source.partial
      ? "partial"
      : source.records
        ? "ready"
        : "empty";
    sources.push(source);
  }
  const buckets = new Map();
  for (const r of records.values()) {
    const key = JSON.stringify([r.day, r.hour, r.client, r.provider, r.model]);
    const b = buckets.get(key) || {
      day: r.day,
      hour: r.hour,
      client: r.client,
      model: r.model,
      provider: r.provider,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      calls: 0,
      sessions: new Set(),
    };
    for (const k of [
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
      "reasoning",
      "calls",
    ])
      b[k] += r[k];
    for (const s of r.sessions || [r.session].filter(Boolean))
      b.sessions.add(s);
    buckets.set(key, b);
  }
  // Session digests are used only for distinct counts across model/day groups.
  return {
    cache,
    snapshot: {
      rows: [...buckets.values()].map((b) => ({
        ...b,
        sessions: [...b.sessions],
      })),
      sources,
      from,
      to,
      updatedAt: new Date(now).toISOString(),
      timeZone,
    },
  };
}
module.exports = {
  CLIENTS,
  dayKey,
  normalized,
  parser,
  readJsonl,
  readOpenCode,
  readDsh,
  scan,
};
