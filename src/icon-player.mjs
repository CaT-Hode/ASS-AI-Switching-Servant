import { iconMotion } from "./icon-motion-recipes.mjs";

// A single delegated player. Actions never wait; repeated input continues the
// current illustration rather than jumping back to its first frame.
export function attachIconMotion(root, win = window) {
  const active = new Map();
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  const hover = win.matchMedia("(hover: hover) and (pointer: fine)");
  const selector = "button, summary, label";
  const clear = () => {
    for (const [svg, animations] of active) {
      animations.forEach((animation) => animation.cancel());
      delete svg.dataset.iconAnimating;
    }
    active.clear();
  };
  const play = (event, pressed = false) => {
    if (root.hidden || reduced.matches || (!pressed && (!hover.matches || event.pointerType === "touch"))) return;
    if (pressed && (event.button !== 0 || event.isPrimary === false)) return;
    const host = event.target.closest?.(selector);
    if (!host || !root.contains(host) || host.matches(":disabled, [aria-disabled='true'], [aria-busy='true'], .theme-toggle")) return;
    if (host.tagName === "LABEL" && !host.querySelector('input:is([type="checkbox"], [type="radio"]):not(:disabled)')) return;
    if (!pressed && event.relatedTarget && host.contains(event.relatedTarget)) return;
    for (const svg of host.querySelectorAll("svg[data-motion-icon]")) {
      if (svg.closest(selector) !== host || svg.closest(".spin")) continue;
      if (active.has(svg)) {
        if (pressed) active.get(svg).forEach((a) => a.updatePlaybackRate(1.35));
        continue;
      }
      const animations = (iconMotion[svg.dataset.motionIcon] || []).flatMap((track) => {
        const part = svg.querySelector(`[data-part="${track.part}"]`);
        return part ? [part.animate(track.frames, { duration: track.duration, delay: track.delay, easing: track.easing, fill: "none" })] : [];
      });
      if (!animations.length) continue;
      active.set(svg, animations); svg.dataset.iconAnimating = "true";
      Promise.allSettled(animations.map((a) => a.finished)).then(() => {
        if (active.get(svg) !== animations) return;
        active.delete(svg); delete svg.dataset.iconAnimating;
        animations.forEach((a) => a.cancel());
      });
    }
  };
  const over = (event) => play(event), down = (event) => play(event, true);
  const visibility = () => { if (root.hidden) clear(); };
  root.addEventListener("pointerover", over); root.addEventListener("pointerdown", down, true);
  root.addEventListener("keydown", clear, true); root.addEventListener("visibilitychange", visibility);
  win.addEventListener("blur", clear); reduced.addEventListener("change", clear);
  return () => {
    clear(); root.removeEventListener("pointerover", over); root.removeEventListener("pointerdown", down, true);
    root.removeEventListener("keydown", clear, true); root.removeEventListener("visibilitychange", visibility);
    win.removeEventListener("blur", clear); reduced.removeEventListener("change", clear);
  };
}
