// Historical Markdown is untrusted. Only explicit user clicks can open a
// network/email link; files, scripts, embedded data and credentials stay inert.
export function conversationUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
  if (/^#[\w-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) return '';
    return value;
  } catch { return ''; }
}
