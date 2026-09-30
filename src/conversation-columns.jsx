import { useEffect, useRef } from 'react';
const defaults = { projects: 235, threads: 205 };
// The transcript never re-renders per pointer frame. Persist only committed
// widths, keeping continuous 1:1 feedback even outside the separator.
export function useConversationColumns(preferences, save) {
  const root = useRef(null), values = useRef({ ...defaults, ...preferences }), drag = useRef(null), saveRef = useRef(save);
  saveRef.current = save;
  function apply(next) {
    const node = root.current, w = node?.querySelector('.project-sync-layout')?.clientWidth || 1000;
    const projects = Math.max(170, Math.min(next.projects, 520, w - 450));
    const threads = Math.max(170, Math.min(next.threads, 520, w - projects - 280));
    values.current = { projects: Math.round(projects), threads: Math.round(threads) };
    if (node) {
      node.style.setProperty('--project-column-width', values.current.projects + 'px');
      node.style.setProperty('--thread-column-width', values.current.threads + 'px');
      for (const key of ['projects', 'threads']) node.querySelector(`[data-column="${key}"]`)?.setAttribute('aria-valuenow', String(values.current[key]));
    }
  }
  useEffect(() => {
    if (!drag.current) apply({ ...defaults, ...preferences });
  }, [preferences?.projects, preferences?.threads]);
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (!drag.current) apply(values.current); });
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); root.current?.removeAttribute('data-resizing'); };
  }, []);
  function end(e, cancel = false) {
    const current = drag.current; if (!current) return;
    drag.current = null; root.current?.removeAttribute('data-resizing');
    if (cancel) apply(current.start);
    else saveRef.current({ ...values.current });
    if (e.currentTarget.hasPointerCapture?.(current.pointerId)) e.currentTarget.releasePointerCapture(current.pointerId);
  }
  function separator(key) {
    return { role: 'separator', tabIndex: 0, 'aria-orientation': 'vertical', 'aria-label': key === 'projects' ? '调整项目栏宽度' : '调整对话栏宽度',
      'aria-valuemin': 170, 'aria-valuemax': 520, 'aria-valuenow': values.current[key], 'data-column': key,
      className: 'conversation-column-resizer ' + key,
      onPointerDown(e) {
        if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { key, x: e.clientX, start: { ...values.current }, pointerId: e.pointerId }; root.current?.setAttribute('data-resizing', key);
      },
      onPointerMove(e) { if (drag.current?.pointerId === e.pointerId) apply({ ...drag.current.start, [key]: drag.current.start[key] + e.clientX - drag.current.x }); },
      onPointerUp(e) { end(e); }, onPointerCancel(e) { end(e, true); }, onLostPointerCapture(e) { end(e); },
      onDoubleClick() { apply({ ...values.current, [key]: defaults[key] }); saveRef.current({ ...values.current }); },
      onKeyDown(e) {
        if (e.key === 'Escape' && drag.current) { end(e, true); return; }
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return;
        e.preventDefault(); apply({ ...values.current, [key]: e.key === 'Home' ? defaults[key] : values.current[key] + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 25 : 10) });
        saveRef.current({ ...values.current });
      } };
  }
  return { root, separator };
}
