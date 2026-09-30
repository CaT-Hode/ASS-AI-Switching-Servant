import React, { memo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { conversationUrl } from '../core/conversation-url.mjs';

const plugins = [remarkGfm];
function MarkdownLink({ href, children, title }) {
  if (!href) return React.createElement('span', { title }, children);
  return React.createElement('a', { href, title, onClick: (event) => {
    event.preventDefault();
    if (href.startsWith('#')) {
      event.currentTarget.closest('.conversation-markdown')?.querySelector('#' + CSS.escape(href.slice(1)))?.scrollIntoView({ block: 'nearest' });
    } else window.ass.call('conversation-open-link', href).catch(() => {});
  } }, children);
}
function MarkdownImage({ src, alt, title }) {
  const [loaded, setLoaded] = useState('');
  if (!src || !/^https?:/i.test(src)) return React.createElement('span', { className: 'markdown-image-unavailable' }, alt || '图片');
  // Don't contact URLs found in an old transcript until the user asks to view
  // that exact image. A changed source never inherits an earlier click.
  return loaded === src
    ? React.createElement('img', { src, alt, title, loading: 'lazy', referrerPolicy: 'no-referrer' })
    : React.createElement('button', { type: 'button', className: 'markdown-image-load', onClick: () => setLoaded(src), title: src }, '查看图片' + (alt ? ' · ' + alt : ''));
}
const components = {
  a: MarkdownLink,
  img: MarkdownImage,
  table: ({ children }) => React.createElement('div', { className: 'markdown-table-scroll', tabIndex: 0, role: 'region', 'aria-label': '对话表格' }, React.createElement('table', null, children)),
};
export const ConversationMarkdown = memo(function ConversationMarkdown({ text }) {
  return React.createElement('div', { className: 'conversation-markdown' },
    React.createElement(Markdown, { remarkPlugins: plugins, components, urlTransform: conversationUrl }, text || ''));
});
