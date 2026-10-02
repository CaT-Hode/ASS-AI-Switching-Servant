const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { SseMonitor } = require('../core/sse-monitor.cjs');
const { sseMessages, translateStream } = require('../core/adapters.cjs');
const { messagesEvents } = require('../core/messages-adapter.cjs');
const { Router } = require('../core/router.cjs');
const bytes = s => new TextEncoder().encode(s);
const stream = events => new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('')).body;
const collect = async iter => { const result = []; for await (const e of iter) result.push(e); return result; };
const temp = t => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ass-r2-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };
for (const ending of ['\n', '\r\n', '\r']) test('SSE UTF8 every-byte boundaries and multiline ' + JSON.stringify(ending), async () => {
  const text = ':comment' + ending + 'data: {"text":' + ending + 'data: "中文 😀"}' + ending + ending;
  const input = bytes(text), body = new ReadableStream({ start(c) { for (const byte of input) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  assert.deepEqual(await collect(sseMessages(body)), [{ text: '中文 😀' }]);
});
test('failed provider event is never forwarded at any network split', () => {
  const raw = bytes('event: response.failed\ndata: {"type":"response.failed","response":{"error":{"message":"synthetic-secret"}}}\n\n');
  for (let split = 1; split < raw.length; split++) {
    const monitor = new SseMonitor();
    assert.deepEqual(monitor.feed(raw.slice(0, split)), []);
    assert.throws(() => monitor.feed(raw.slice(split)), e => !e.message.includes('synthetic-secret'));
  }
});
test('SSE truncated and bounded events fail and cancel the reader', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(bytes('data: {broken}\n\n')); }, cancel() { cancelled = true; } });
  await assert.rejects(collect(sseMessages(body)), /JSON/); assert.equal(cancelled, true);
  const { SseParser } = require('../core/sse-parser.cjs');
  assert.throws(() => new SseParser(32).feed(bytes('data: ' + 'x'.repeat(32))), /限制/);
  const p = new SseParser(); p.feed(bytes('data: {}')); assert.throws(() => p.feed(null, true), /完整/);
});
for (const protocol of ['openai-responses', 'anthropic', 'openai-chat']) test('harness terminal cancels open upstream ' + protocol, async t => {
  let cancelled = false, signal;
  const event = protocol === 'anthropic' ? { type: 'message_stop' } : protocol === 'openai-responses' ? { type: 'response.completed', response: {} } : { done: true };
  const router = new Router({ getState: () => ({ providers: [{ id: 'p', name: 'test', enabled: true, apiKey: 'synthetic-key', baseUrl: 'https://provider.test', models: [{ model: 'm', enabled: true, wireApi: protocol }] }] }),
    fetchUpstream: async (_, init) => { signal = init.signal; return new Response(new ReadableStream({ start(c) { c.enqueue(bytes(event.done ? 'data: [DONE]\n\n' : 'data: ' + JSON.stringify(event) + '\n\n')); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }); } });
  await router.start(0); t.after(() => router.stop());
  const endpoint = protocol === 'anthropic' ? 'messages' : protocol === 'openai-chat' ? 'chat/completions' : 'responses';
  const response = await fetch('http://127.0.0.1:' + router.port + '/clients/pi/harness/p/v1/' + endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + router.clientToken }, body: JSON.stringify({ model: 'm', stream: true }), signal: AbortSignal.timeout(3000) });
  await response.text(); assert.equal(cancelled, true); assert.equal(signal.aborted, true); assert.equal(router.active, 0);
});
test('Codex Responses terminal completes without EOF and failed split never leaks', async t => {
  let cancelled = 0, failed = false;
  const provider = { id: 'p', name: 'test', enabled: true, apiKey: 'synthetic-secret', baseUrl: 'https://provider.test', models: [{ model: 'm', enabled: true, wireApi: 'openai-responses' }] };
  const logs = [], router = new Router({ getState: () => ({ providers: [provider] }), log: row => logs.push(row), fetchUpstream: async () => new Response(new ReadableStream({ start(c) {
    if (failed) { const b = bytes('data: {"type":"response.failed","error":{"message":"synthetic-secret"}}\n\n'); c.enqueue(b.slice(0, -2)); setTimeout(() => c.enqueue(b.slice(-2)), 5); }
    else c.enqueue(bytes('data: {"type":"response.completed","response":{}}\n\n'));
  }, cancel() { cancelled++; } }), { headers: { 'content-type': 'text/event-stream' } }) });
  await router.start(0); t.after(() => router.stop());
  const request = () => fetch('http://127.0.0.1:' + router.port + '/clients/ASS/v1/responses', { method: 'POST', headers: { authorization: 'Bearer ' + router.clientToken }, body: JSON.stringify({ model: require('../core/models.cjs').codexModelId('p', 'm'), stream: true }), signal: AbortSignal.timeout(3000) });
  assert.match(await (await request()).text(), /response.completed/); failed = true;
  const raw = await (await request()).text(); assert.doesNotMatch(raw + JSON.stringify(logs), /synthetic-secret/); assert.match(raw, /stream_failed/); assert.equal(cancelled, 2); assert.equal(router.active, 0);
});
test('backpressure drain races leave no losing listeners', async () => {
  const res = new (require('node:events').EventEmitter)(); res.write = () => { queueMicrotask(() => res.emit('drain')); return false; };
  for (let i = 0; i < 40; i++) await require('../core/stream-write.cjs').write(res, 'x');
  for (const name of ['drain', 'close', 'error']) assert.equal(res.listenerCount(name), 0);
  res.write = () => { queueMicrotask(() => res.emit('close')); return false; };
  await assert.rejects(require('../core/stream-write.cjs').write(res, 'x'), /断开/);
  assert.equal(res.listenerCount('error'), 0);
});
test('empty Anthropic input is valid and ambiguous fragmented names fail explicitly', async () => {
  const events = await collect(translateStream(stream([{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call', name: 'ping', input: {} } }, { type: 'content_block_stop', index: 0 }, { type: 'message_stop' }]), 'anthropic', 'm'));
  assert.equal(events.at(-1).response.output[0].arguments, '{}');
  await assert.rejects(collect(translateStream(stream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'get_', arguments: '{' } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'weather', arguments: '}' } }] }, finish_reason: 'tool_calls' }] }]), 'openai-chat', 'm')), /分段工具名称/);
});
test('refusal and content_filter are explicit failures across conversion paths', async () => {
  for (const choice of [{ delta: { refusal: 'No' } }, { delta: { content: 'partial' }, finish_reason: 'content_filter' }]) await assert.rejects(collect(translateStream(stream([{ choices: [choice] }]), 'openai-chat', 'm')), /拒绝|过滤/);
  await assert.rejects(collect(messagesEvents(stream([{ type: 'response.refusal.delta', delta: 'No' }]), 'openai-responses', 'm')), /拒绝/);
  await assert.rejects(collect(messagesEvents(stream([{ type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } }]), 'openai-responses', 'm')), /过滤/);
});
test('Codex aborted/pending suffix is preview-only; committed and resumed turns share', () => {
  const c = require('../core/project-codecs.cjs'), base = [{ type: 'session_meta', payload: { id: 'id', cwd: '/project' } }];
  const life = type => ({ type: 'event_msg', payload: { type } }), message = text => ({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: text } });
  const log = [...base, life('task_started'), message('complete'), life('task_complete'), life('task_started'), message('partial'), life('turn_aborted')];
  assert.equal(c.decode('codex', log).pending, true); assert.deepEqual(c.decode('codex', log).messages.map(m => m.text), ['complete']);
  assert.equal(c.decode('codex', log, { completed: false }).messages.length, 2);
  assert.equal(c.decode('codex', [...log, life('task_started'), message('resumed'), life('task_complete')]).messages.length, 2);
  assert.equal(c.decode('codex', [...base, message('legacy')]).messages.length, 1);
});
test('OpenCode standalone classification ignores shared credential table and refuses ambiguity', t => {
  const root = temp(t), { DatabaseSync } = require('node:sqlite'), v = require('../core/opencode-version.cjs'), db = new DatabaseSync(path.join(root, 'opencode.db'));
  db.exec('CREATE TABLE credential(id); CREATE TABLE session(id); CREATE TABLE message(id); CREATE TABLE part(id)'); db.close(); assert.equal(v.version({}, root), 1); assert.equal(v.version({ version: '2.0.20' }, root), 2);
  const both = new DatabaseSync(path.join(root, 'opencode.db')); both.exec('CREATE TABLE session_v2(id); CREATE TABLE session_message(id)'); both.close(); assert.throws(() => v.version({}, root), /唯一/);
});
test('OpenCode semantic import check tolerates updated/import projectID, refuses changed body/cwd', () => {
  const v = require('../core/opencode-version.cjs'), a = v.encode({ id: 'ses_test', cwd: '/project', title: 't', messages: [{ role: 'user', text: 'hello' }], createdAt: '2026-10-01T00:00:00Z' }), b = structuredClone(a);
  b.info.time.updated++; b.info.projectID = 'native-generated'; assert.ok(v.equal(a, b)); b.messages[0].text = 'other'; assert.equal(v.equal(a, b), false); b.messages[0].text = 'hello'; b.info.location.directory = '/other'; assert.equal(v.equal(a, b), false);
});
test('API key control characters are rejected without quoting secrets', () => {
  const { normalizeProvider } = require('../core/models.cjs');
  for (const key of ['synthetic\nkey', 'synthetic\rkey', 'synthetic\0key']) assert.throws(() => normalizeProvider({ id: 'p', baseUrl: 'https://provider.test', apiKey: key }), e => !e.message.includes('synthetic'));
});

test('protocol terminal discards bytes after completion in the same network chunk', async () => {
  const monitor = new SseMonitor();
  const output = monitor.feed(bytes('data: {"type":"response.completed"}\n\ndata: {broken}\n\n'));
  assert.equal(monitor.ended, true); assert.equal(output.length, 1);
  const got = await collect(sseMessages(new Response('data: [DONE]\n\ndata: {broken}\n\n').body));
  assert.deepEqual(got, [{ done: true }]);
});
