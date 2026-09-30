const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { ConversationLibrary, switchWithConversations } = require("../core/conversations.cjs");
const { OAuthHistory } = require("../core/oauth-history.cjs");
const { HarnessManager } = require("../core/harnesses.cjs");
const { Preferences } = require("../core/preferences.cjs");
const { switchClientAccount } = require('../core/client-account-switch.cjs');
for (const harness of ['codex', 'claude']) for (const mode of ['close', 'restart']) test(`${harness} OAuth ${mode}: stop, preserve, switch; only restart relaunches`, async (t) => {
  const f = fixture(t, harness); f.save('alice'); const alice = f.history.entries[0].id; f.save('bob');
  const p = f.history.preview(harness, alice); f.history.tickets.get(p.ticket).lifecycle = { available: true, closeAvailable: true };
  const steps = [], originalApply = f.history.apply.bind(f.history), originalPreserve = f.library.preserve.bind(f.library);
  f.history.apply = (...args) => { steps.push('switch'); return originalApply(...args); };
  f.library.preserve = (...args) => { steps.push('preserve'); return originalPreserve(...args); };
  const restarter = { close: async () => steps.push('close'), stop: async () => steps.push('stop'), launch: async (_, before) => { before(); steps.push('launch'); return { ok: true }; } };
  const active = { [harness]: 2, unrelated: 5 }, router = { clientActive: (id) => active[id] || 0, cancelClient: async (id) => { steps.push('cancel'); active[id] = 0; } }, blocked = new Set();
  const before = fs.readFileSync(f.file), result = await switchClientAccount({ history: f.history, library: f.library, restarter, router, blocked, ticket: p.ticket, confirmed: true, mode });
  assert.deepEqual(steps, [mode === 'close' ? 'close' : 'stop', 'cancel', 'preserve', 'switch', ...(mode === 'restart' ? ['launch'] : [])]);
  assert.equal(result.conversations.retained, 1); assert.equal(active.unrelated, 5); assert.equal(blocked.size, 0); assert.deepEqual(fs.readFileSync(f.file), before);
});
test('OAuth force action rejects stale login before closing any client', async (t) => {
  const f = fixture(t); f.save('alice'); const alice = f.history.entries[0].id; f.save('bob');
  const p = f.history.preview('codex', alice); f.history.tickets.get(p.ticket).lifecycle = { closeAvailable: true }; f.save('carol');
  let stops = 0; await assert.rejects(switchClientAccount({ history: f.history, library: f.library, ticket: p.ticket, confirmed: true, mode: 'close',
    restarter: { close: async () => stops++ }, blocked: new Set(), router: { clientActive: () => 0 } }), /变化/); assert.equal(stops, 0);
});
const ID = "123e4567-e89b-12d3-a456-426614174000", SECOND = "223e4567-e89b-12d3-a456-426614174000";
const jwt = (v) => "header." + Buffer.from(JSON.stringify(v)).toString("base64url") + ".signature";
function grant(user) {
  return { auth_mode: "chatgpt", extra: { keep: true }, tokens: { access_token: jwt({ exp: 2100000000, sub: user,
    "https://api.openai.com/auth": { chatgpt_account_id: "workspace", chatgpt_user_id: user } }),
    id_token: jwt({ email: user + "@example.test", "https://api.openai.com/auth": { chatgpt_account_id: "workspace", chatgpt_user_id: user } }),
    account_id: "workspace", refresh_token: "private-refresh-" + user } };
}
function write(file, v) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof v === "string" ? v : JSON.stringify(v)); }
function transcript(harness, dir, cwd, id = ID, text = "Private conversation carried between accounts") {
  const file = path.join(dir, harness === "codex" ? `sessions/2026/09/30/rollout-2026-09-30T10-00-00-${id}.jsonl` : `projects/project/${id}.jsonl`);
  const rows = harness === "codex" ? [
    { type: "session_meta", payload: { id, cwd, model_provider: "openai", timestamp: "2026-09-30T00:00:00Z" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Saved answer" }] } },
  ] : [
    { type: "user", sessionId: id, cwd, uuid: "user-uuid", message: { role: "user", content: text } },
    { type: "assistant", sessionId: id, cwd, message: { role: "assistant", model: "claude-test", content: [{ type: "text", text: "Saved answer" }] } },
  ];
  write(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); return file;
}
function fixture(t, harness = "codex") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ass-conversations-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home"), dir = path.join(home, harness === "codex" ? ".codex" : ".claude");
  const auth = path.join(dir, harness === "codex" ? "auth.json" : ".credentials.json"), workspace = path.join(root, "project");
  fs.mkdirSync(workspace, { recursive: true });
  const secret = crypto.randomBytes(32), encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", secret, iv); const body = Buffer.concat([c.update(s), c.final()]); return Buffer.concat([iv, c.getAuthTag(), body]); },
    decryptString: (b) => { const c = crypto.createDecipheriv("aes-256-gcm", secret, b.subarray(0, 12)); c.setAuthTag(b.subarray(12, 28)); return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(); },
  };
  const sources = [{ harness, dir, native: true }];
  const options = { dataDir: root, crypto: encryption, sources: () => sources };
  const library = new ConversationLibrary(options), history = new OAuthHistory({ ...options, target: () => sources[0] });
  const save = (user) => {
    if (harness === "codex") write(auth, grant(user));
    else { write(auth, { claudeAiOauth: { accessToken: user, refreshToken: "private-refresh-" + user, accountId: user, expiresAt: 2100000000000 }, extra: "keep" });
      write(path.join(home, ".claude.json"), { oauthAccount: { accountUuid: user, emailAddress: user + "@example.test" }, projects: { [workspace]: { lastSessionId: ID, hasTrustDialogAccepted: true } }, theme: "dark" }); }
    history.scan({ immediate: true });
  };
  return { root, home, dir, auth, workspace, sources, options, encryption, library, history, save,
    file: transcript(harness, dir, workspace) };
}
for (const harness of ["codex", "claude"]) test(`OAuth retention: ${harness} A-B-A changes auth only and durably retains conversations`, async (t) => {
  const f = fixture(t, harness); f.save("alice"); const alice = f.history.entries[0].id; f.save("bob");
  const text = fs.readFileSync(f.file), unrelated = path.join(f.dir, "settings.json"); write(unrelated, { hooks: { preserve: true } });
  const settings = fs.readFileSync(unrelated), index = path.join(f.dir, "session_index.jsonl"); write(index, JSON.stringify({ id: ID, thread_name: "Retained project" }) + "\n");
  const indexText = fs.readFileSync(index), selected = [];
  const p = f.history.preview(harness, alice);
  const result = await switchWithConversations({ history: f.history, library: f.library, ticket: p.ticket, confirmed: true, selectTarget: (h) => selected.push(h) });
  assert.equal(result.conversations.retained, 1); assert.deepEqual(selected, [harness]);
  assert.deepEqual(fs.readFileSync(f.file), text); assert.deepEqual(fs.readFileSync(unrelated), settings); assert.deepEqual(fs.readFileSync(index), indexText);
  const data = JSON.parse(fs.readFileSync(f.auth)); assert.equal(harness === "codex" ? data.tokens.refresh_token : data.claudeAiOauth.refreshToken, "private-refresh-alice");
  if (harness === "claude") assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, ".claude.json"))).projects, { [f.workspace]: { lastSessionId: ID, hasTrustDialogAccepted: true } });
  const reloaded = new ConversationLibrary(f.options), list = await reloaded.list({ harness }); assert.equal(list.count, 1); assert.equal(list.retained, 1);
  assert.match((await reloaded.preview(list.items[0].id)).messages[0].text, /carried between accounts/);
  const disk = fs.readFileSync(reloaded.file, "utf8"); assert.ok(!disk.includes("Private conversation") && !disk.includes("private-refresh"));
  for (const name of fs.readdirSync(path.join(reloaded.vault, "records"))) assert.ok(!fs.readFileSync(path.join(reloaded.vault, "records", name)).includes(Buffer.from("Private conversation")));
});
for (const harness of ["codex", "claude"]) test(`OAuth retention: ${harness} missing originals recover from encrypted copy without credentials`, async (t) => {
  const f = fixture(t, harness); f.save("alice"); await f.library.preserve(harness);
  fs.unlinkSync(f.file); const library = new ConversationLibrary(f.options), row = (await library.list({ harness })).items[0];
  assert.equal(row.nativePresent, false); assert.equal(row.retained, true); assert.equal((await library.preview(row.id)).messages.length, 2);
  const target = path.join(f.root, "new-active-home"); write(path.join(target, "auth.json"), { identity: "bob" });
  const result = await library.stage(row.id, target); assert.equal(result.copied, true);
  assert.match(fs.readFileSync(result.file, "utf8"), /Private conversation/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, "auth.json"))), { identity: "bob" });
  assert.equal(fs.existsSync(path.join(target, ".credentials.json")), false);
});
test("OAuth retention: all OAuth and runtime homes are aggregated, not filtered by selected account", async (t) => {
  const f = fixture(t), profile = path.join(f.root, "clients/codex/abcdef012345abcdef012345");
  transcript("codex", profile, f.workspace, SECOND, "An isolated account's conversation");
  const manager = new HarnessManager(f.root, () => ({ providers: [] }), [], f.dir, { home: f.home, env: {}, launchEnv: { PATH: "" } });
  manager.state.profiles.push({ id: "abcdef012345abcdef012345", harness: "codex", label: "Saved profile" });
  manager.state.selected.codex = "some-other-account";
  const library = new ConversationLibrary({ ...f.options, sources: () => manager.conversationSources() });
  assert.equal((await library.list()).count, 2); assert.equal((await library.list({ query: "isolated" })).total, 1);
  const first = (await library.list()).items.find((r) => r.sessionId === ID); await library.pin(first.id, true);
  const reloaded = new ConversationLibrary({ ...f.options, sources: () => manager.conversationSources() });
  assert.equal((await reloaded.list({ pinned: true })).items[0].sessionId, ID);
});
test("OAuth retention: plaintext credentials and native indexes are never part of snapshots", async (t) => {
  const f = fixture(t); write(path.join(f.dir, "auth.json"), "not-a-transcript"); write(path.join(f.dir, "random.jsonl"), "private-secret");
  const list = await f.library.list(); assert.equal(list.count, 1); await f.library.preserve("codex");
  assert.equal(fs.readdirSync(path.join(f.library.vault, "records")).length, 1);
});
test("OAuth retention: failed encryption prevents the OAuth write, existing transcript remains", async (t) => {
  const f = fixture(t); f.save("alice"); const alice = f.history.entries[0].id; f.save("bob");
  const before = fs.readFileSync(f.auth), p = f.history.preview("codex", alice); f.encryption.isEncryptionAvailable = () => false;
  await assert.rejects(switchWithConversations({ history: f.history, library: f.library, ticket: p.ticket, confirmed: true }), /加密/);
  assert.deepEqual(fs.readFileSync(f.auth), before); assert.ok(fs.existsSync(f.file));
});
test("OAuth retention: native token refresh during snapshot invalidates switch, never rolls it back", async (t) => {
  const f = fixture(t); f.save("alice"); const alice = f.history.entries[0].id; f.save("bob"); const p = f.history.preview("codex", alice);
  const library = { preserve: async () => { write(f.auth, grant("carol")); return { retained: 1 }; } };
  await assert.rejects(switchWithConversations({ history: f.history, library, ticket: p.ticket, confirmed: true }), /变化/);
  assert.equal(JSON.parse(fs.readFileSync(f.auth)).tokens.refresh_token, "private-refresh-carol");
});
test("OAuth retention: cancelled switch cannot snapshot or mutate anything", async (t) => {
  const f = fixture(t); f.save("alice"); const p = f.history.preview("codex", f.history.entries[0].id);
  await assert.rejects(switchWithConversations({ history: f.history, library: { preserve: () => { throw Error("must not run"); } }, ticket: p.ticket, confirmed: false }), /失效/);
  assert.equal(fs.existsSync(f.library.file), false);
});
test("OAuth retention: incremental snapshots update once without duplicate conversation rows", async (t) => {
  const f = fixture(t); await f.library.preserve("codex");
  fs.appendFileSync(f.file, JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "New follow-up" }] } }) + "\n");
  await f.library.preserve("codex"); const list = await f.library.list();
  assert.equal(list.count, 1); assert.equal((await f.library.preview(list.items[0].id)).messages.length, 3);
  assert.equal(fs.readdirSync(path.join(f.library.vault, "records")).length, 1);
  const old = f.library.entries[0].snapshot.blob; await f.library.preserve("codex"); assert.equal(f.library.entries[0].snapshot.blob, old);
});
test("OAuth retention: tampered backup never installs a partially decrypted native transcript", async (t) => {
  const f = fixture(t); await f.library.preserve("codex"); const row = (await f.library.list()).items[0];
  const file = path.join(f.library.vault, "records", f.library.entries[0].snapshot.blob), bytes = fs.readFileSync(file); bytes[bytes.length - 1] ^= 0xff; fs.writeFileSync(file, bytes); fs.unlinkSync(f.file);
  await assert.rejects(f.library.preview(row.id)); const target = path.join(f.root, "restore");
  await assert.rejects(f.library.stage(row.id, target));
  assert.equal(fs.existsSync(path.join(target, f.library.entries[0].relative)), false);
});
test("OAuth retention: native restore never replaces an existing different transcript", async (t) => {
  const f = fixture(t); const row = (await f.library.list()).items[0], target = path.join(f.root, "other-home");
  const conflict = path.join(target, f.library.entries[0].relative); write(conflict, "keep-current-conversation");
  await assert.rejects(f.library.stage(row.id, target), /未覆盖/); assert.equal(fs.readFileSync(conflict, "utf8"), "keep-current-conversation");
  await assert.rejects(f.library.preview("../../auth.json"), /标识无效/);
  await assert.rejects(f.library.list({ harness: "pi" }), /仅支持/);
});
test("OAuth retention: current login home is used on resume, never isolated source's old auth", async (t) => {
  const f = fixture(t, "claude"); f.save("bob");
  const manager = new HarnessManager(f.root, () => ({ providers: [] }), [], path.join(f.home, ".codex"), { home: f.home, env: {}, launchEnv: { PATH: "" } });
  const row = (await f.library.list({ harness: "claude" })).items[0], oldHome = path.join(f.root, "old-credential-home");
  const oldFile = transcript("claude", oldHome, f.workspace); write(path.join(oldHome, ".credentials.json"), { oldSecret: true });
  const plan = manager.conversationPlan("claude", row, oldFile);
  assert.equal(plan.env.CLAUDE_CONFIG_DIR, f.dir); assert.deepEqual(plan.files, []); assert.deepEqual(plan.args, ["--resume", oldFile]);
  assert.equal(plan.workspace, f.workspace);
});
test("OAuth retention: native indexes enrich names without mutating the SQLite database", async (t) => {
  const f = fixture(t), { DatabaseSync } = require("node:sqlite"), file = path.join(f.dir, "state_5.sqlite");
  const db = new DatabaseSync(file); db.exec("CREATE TABLE threads (id TEXT, title TEXT, cwd TEXT)");
  db.prepare("INSERT INTO threads VALUES (?, ?, ?)").run(ID, "Title from native index", f.workspace); db.close();
  const before = fs.readFileSync(file); const list = await f.library.list(); assert.equal(list.items[0].title, "Title from native index");
  assert.deepEqual(fs.readFileSync(file), before);
});
test("OAuth retention: paginated preview keeps recent messages, not an eager full renderer payload", async (t) => {
  const f = fixture(t); for (let i = 0; i < 95; i++) fs.appendFileSync(f.file, JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `Message ${i}` }] } }) + "\n");
  const row = (await f.library.list()).items[0], first = await f.library.preview(row.id), older = await f.library.preview(row.id, 40);
  assert.equal(first.messages.length, 40); assert.equal(first.total, 97); assert.equal(first.hasEarlier, true); assert.equal(older.messages.length, 40);
  assert.equal(first.messages.at(-1).text, "Message 94"); assert.equal(older.messages.at(-1).text, "Message 54");
});
test("OAuth retention: same UUID in multiple homes is shown once rather than as duplicate accounts", async (t) => {
  const f = fixture(t), other = path.join(f.root, "old-profile"); transcript("codex", other, f.workspace); f.sources.push({ harness: "codex", dir: other });
  assert.equal((await f.library.list()).count, 1);
});
test("OAuth retention: an active-home copy inherits logical pins but different-path UUID conflicts never duplicate", async (t) => {
  const f = fixture(t), row = (await f.library.list()).items[0], target = path.join(f.root, "current-home");
  await f.library.pin(row.id, true); await f.library.stage(row.id, target); f.sources.push({ harness: "codex", dir: target });
  assert.equal((await f.library.list({ pinned: true, refresh: true })).count, 1);
  assert.equal((await f.library.list({ pinned: true })).total, 1);
  const another = path.join(f.root, "conflicting-home"), file = transcript("codex", another, f.workspace);
  const moved = path.join(another, `sessions/2025/01/01/rollout-old-${ID}.jsonl`); fs.mkdirSync(path.dirname(moved), { recursive: true }); fs.renameSync(file, moved);
  await assert.rejects(f.library.stage(row.id, another), /相同 ID/); assert.equal(fs.readFileSync(moved, "utf8").includes("Private conversation"), true);
});
test("OAuth retention: desktop preferences persist client selection and pin filter", (t) => {
  const f = fixture(t), prefs = new Preferences(f.root); prefs.update({ view: "conversations", conversations: { harness: "claude", pinned: true } });
  assert.equal(new Preferences(f.root).state.view, "conversations"); assert.deepEqual(new Preferences(f.root).state.conversations, { harness: "claude", pinned: true, scope: "projects", project: "" });
});
