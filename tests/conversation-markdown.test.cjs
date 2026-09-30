const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');

async function render(text) {
  const { ConversationMarkdown } = await import('../src/conversation-markdown.mjs');
  return renderToStaticMarkup(React.createElement(ConversationMarkdown, { text }));
}
test('conversation Markdown renders CommonMark and GFM structures, preserving literal fenced code', async () => {
  const html = await render('# Title\n\n**Bold** and *italic* with `inline()`\n\n> Quote\n\n1. First\n2. Second\n\n- [x] Done\n- [ ] Pending\n\n| Model | Result |\n| --- | --- |\n| One | OK |\n\n```js\nconst literal = "<script>";\n```\n\n~~Old~~\n\nhttps://example.test/docs');
  for (const pattern of [/<h1>Title<\/h1>/, /<strong>Bold<\/strong>/, /<em>italic<\/em>/, /<code>inline\(\)<\/code>/,
    /<blockquote>/, /<ol>/, /disabled=""/, /checked=""/, /class="markdown-table-scroll"/, /<th>Model<\/th>/,
    /<pre><code class="language-js">/, /&lt;script&gt;/, /<del>Old<\/del>/, /href="https:\/\/example.test\/docs"/]) assert.match(html, pattern);
});
test('history cannot inject active HTML, scripts, file URLs or automatically fetched images', async () => {
  const html = await render('<script>throw Error("not executed")</script>\n\n<img src="https://example.test/tracker" onerror="evil()">\n\n[unsafe](javascript:alert%281%29) [file](file:///C:/private)\n\n![Remote](https://example.test/picture.png)');
  assert.ok(!/<script[\s>]|<img[\s>]|href="(?:javascript|file|data):|onerror=/i.test(html.replace(/&lt;img[\s\S]*?&gt;/g, '')));
  assert.match(html, /&lt;script&gt;/); assert.match(html, /查看图片 · Remote/);
  assert.ok(!html.includes('rel="preload"'));
});
test('URL policy accepts explicit web/email and local footnotes, rejecting credentials and executable protocols', async () => {
  const { conversationUrl } = await import('../core/conversation-url.mjs');
  for (const url of ['https://example.test/docs', 'http://127.0.0.1:3000/', 'mailto:hello@example.test', '#user-content-fn-1']) assert.equal(conversationUrl(url), url);
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///C:/private', 'codex://threads/private', 'https://user:secret@example.test/',
    'https://example.test/\nother', ' https://example.test/', '//example.test/', './local.md', 'D:\\file.md', '', null, 'https://example.test/' + 'a'.repeat(8192)]) assert.equal(conversationUrl(url), '');
});
test('client conversation shortcut is in the connection action row, not the account header', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/clients.jsx'), 'utf8');
  const header = source.slice(source.indexOf('<header className="client-heading">'), source.indexOf('<ConnectionStatus'));
  assert.ok(header.includes('查看保留的对话'));
  assert.ok(header.indexOf('查看保留的对话') < header.indexOf('<ConnectionPill'));
  const accounts = source.slice(source.indexOf('<header className="client-accounts-heading">'), source.indexOf('{client.oauthHistoryError'));
  assert.ok(!accounts.includes('MessagesSquare'));
});
