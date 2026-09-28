import React, { useEffect, useLayoutEffect, useState, useRef, useId } from "react";
import { themeMotion } from "./theme-motion.mjs";

export function applyTheme(theme) {
  const value = ["light", "dark"].includes(theme) ? theme : "system";
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem("ass-theme", value); } catch {}
}
try { applyTheme(localStorage.getItem("ass-theme")); } catch { applyTheme("system"); }
const themePositions = { light: 0, system: .5, dark: 1 };
const themeNames = { light: "浅色", system: "自动", dark: "深色" };
const modes = ["light", "system", "dark"];

function SunMoon() {
  const mask = "theme-cut-" + useId().replace(/:/g, "");
  return <svg className="theme-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <defs><mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <rect x="0" y="0" width="24" height="24" fill="white" stroke="none" />
      <circle className="theme-cut" cx="18" cy="12" r="7.5" fill="black" stroke="none" />
      <rect className="theme-dawn-cut" x="0" y="12" width="24" height="12" fill="black" stroke="none" />
    </mask></defs>
    <g mask={`url(#${mask})`}><circle className="theme-disc" cx="12" cy="12" r="7" />
    <g className="theme-rays"><g className="theme-sun-idle"><path d="M12 1v2M12 21v2M1 12h2M21 12h2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></g></g>
    </g>
    <g className="theme-horizon" strokeLinecap="round"><path d="M4 13h16M7 17h10M10 21h4" /></g>
    <g className="theme-craters" fill="currentColor" stroke="none"><circle cx="7.4" cy="13" r="1" /><circle cx="11" cy="17" r=".7" /></g>
  </svg>;
}
export function ThemeControl({ value = "system", onChange }) {
  const [theme, setTheme] = useState(value);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const button = useRef(null), motion = useRef(null), drag = useRef(null), suppressClick = useRef(false);
  useEffect(() => { setTheme(value); applyTheme(value); }, [value]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update); update();
    return () => media.removeEventListener("change", update);
  }, []);
  const position = themePositions[theme] ?? .5;
  const instantaneous = () => matchMedia("(prefers-reduced-motion: reduce)").matches ||
    button.current?.closest(".app-shell")?.dataset.input === "keyboard";
  useLayoutEffect(() => {
    motion.current = themeMotion(position, (progress, position, settled) => {
      button.current.style.setProperty("--theme-progress", progress);
      button.current.style.setProperty("--theme-position", position);
      button.current.style.setProperty("--theme-transit", 4 * progress * (1 - progress));
      button.current.style.setProperty("--theme-twilight", 1 - Math.abs(2 * progress - 1));
      button.current.style.setProperty("--theme-night", Math.max(0, 2 * progress - 1));
      if (settled) delete button.current.dataset.moving;
      else button.current.dataset.moving = "true";
    });
    const measure = () => button.current.style.setProperty("--theme-travel", `${button.current.clientWidth - 38}px`);
    measure(); const observer = new ResizeObserver(measure); observer.observe(button.current);
    return () => { motion.current.dispose(); observer.disconnect(); };
  }, []);
  useEffect(() => { if (!drag.current) motion.current?.settle(position, { instant: instantaneous() }); }, [position]);
  const commit = (choice, options = {}) => {
    motion.current.settle(themePositions[choice], { instant: instantaneous(), ...options });
    setTheme(choice); applyTheme(choice); onChange(choice);
  };
  const release = (event, cancel = false) => {
    const gesture = drag.current;
    if (!gesture || (event.pointerId !== undefined && gesture.id !== event.pointerId)) return;
    drag.current = null; delete button.current.dataset.dragging;
    if (button.current.hasPointerCapture(gesture.id)) button.current.releasePointerCapture(gesture.id);
    if (cancel) {
      suppressClick.current = true; motion.current.settle(position, { instant: instantaneous() }); return;
    }
    if (!gesture.moved) return; // The native click below commits a simple tap.
    suppressClick.current = true;
    const now = performance.now(), last = gesture.samples.at(-1), first = gesture.samples[0];
    const speed = now - last.time > 90 || last.time === first.time ? 0 :
      Math.max(-8, Math.min(8, (last.position - first.position) / ((last.time - first.time) / 1000)));
    const projected = motion.current.position + Math.max(-.12, Math.min(.12, speed * .06));
    commit(modes[Math.round(Math.max(0, Math.min(1, projected)) * 2)], { speed });
  };
  const nextMode = modes[(modes.indexOf(theme) + 1) % modes.length];
  const label = "切换为" + themeNames[nextMode] + "模式";
  return <div className="theme-control">
    <button ref={button} className="theme-toggle" type="button" data-mode={theme} data-system-dark={systemDark} aria-label={label}
      title={(theme === "system" ? `自动 · 跟随系统（当前${systemDark ? "深色" : "浅色"}）` : themeNames[theme]) + "；" + label}
      aria-pressed={theme === "system" ? "mixed" : theme === "dark"}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.isPrimary === false || drag.current) return;
        suppressClick.current = false;
        const position = motion.current.grab();
        drag.current = { id: event.pointerId, startX: event.clientX, position, moved: false, travel: event.currentTarget.clientWidth - 38,
          samples: [{ position, time: performance.now() }] };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const gesture = drag.current;
        if (!gesture || gesture.id !== event.pointerId) return;
        const dx = event.clientX - gesture.startX;
        if (!gesture.moved && Math.abs(dx) < 4) return;
        gesture.moved = true; button.current.dataset.dragging = "true";
        const position = gesture.position + dx / gesture.travel, time = performance.now();
        gesture.samples = [...gesture.samples.filter((s) => time - s.time < 80), { position, time }].slice(-6);
        motion.current.drag(position);
      }}
      onPointerUp={release} onPointerCancel={(event) => release(event, true)} onLostPointerCapture={(event) => release(event, true)}
      onBlur={(event) => { if (drag.current) release(event, true); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) { event.preventDefault(); release(event, true); }
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const index = event.key === "Home" ? 0 : event.key === "End" ? 2 :
            Math.max(0, Math.min(2, modes.indexOf(theme) + (event.key === "ArrowRight" ? 1 : -1)));
          commit(modes[index], { instant: true });
        }
      }}
      onClick={(event) => {
        if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
        commit(nextMode, { instant: event.detail === 0 || instantaneous() });
      }}>
      <svg className="theme-sky" viewBox="0 0 216 40" preserveAspectRatio="none" aria-hidden="true">
        <g className="theme-cloud-idle"><path className="theme-cloud theme-cloud-far" d="M76 18h29a4 4 0 0 0-4-4h-2a7 7 0 0 0-13-2 8 8 0 0 0-10 6Z" /></g>
        <g className="theme-cloud-idle"><path className="theme-cloud" d="M147 30h42a6 6 0 0 0-6-6h-3a10 10 0 0 0-19-3 10 10 0 0 0-14 9Z" /></g>
        <g className="theme-cloud-idle"><path className="theme-cloud theme-cloud-near" d="M112 36h25a4 4 0 0 0-4-4h-2a6 6 0 0 0-11-2 7 7 0 0 0-8 6Z" /></g>
        <g className="theme-stars theme-stars-early"><path d="M36 9l1.2 3.8L41 14l-3.8 1.2L36 19l-1.2-3.8L31 14l3.8-1.2Z" /><circle cx="61" cy="29" r="1.1" /><circle cx="116" cy="9" r=".8" /></g>
        <g className="theme-stars theme-stars-late"><path d="M137 22l.8 2.5 2.5.8-2.5.8-.8 2.5-.8-2.5-2.5-.8 2.5-.8Z" /><circle cx="84" cy="14" r="1.3" /><circle cx="20" cy="28" r=".8" /></g>
        <path className="theme-comet" d="M92 9l13-4" />
      </svg>
      <span className="theme-orbit"><SunMoon /></span>
    </button>
  </div>;
}
