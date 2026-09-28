import { iconMotion, easeOut } from "./icon-motion-recipes.mjs";

// The player owns transient presentation only. React owns geometry and state.
// Read the current frame before cancelling an animation, then retarget from it.
export function attachIconMotion(root, win = window) {
  const active = new Map();
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  const fine = win.matchMedia("(hover: hover) and (pointer: fine)");
  const selector = "button, summary, label, a[href], [data-icon-control]";
  const owner = (node) => {
    const host = node?.closest?.(selector);
    return host?.matches("[data-icon-scope]") ? host.closest("[data-icon-control]") : host;
  };
  const blocked = (host) => !host || !root.contains(host) || host.matches(":disabled, [aria-disabled='true'], [aria-busy='true'], .theme-toggle") ||
    (host.tagName === "LABEL" && !host.querySelector('input:is([type="checkbox"], [type="radio"]):not(:disabled)'));
  const remove = (record) => {
    record.slots.forEach((slot) => slot.animation.cancel()); record.slots.clear();
    delete record.svg.dataset.iconAnimating; delete record.svg.dataset.iconEngaged; delete record.svg.dataset.iconPhase;
    active.delete(record.svg);
  };
  const clear = () => [...active.values()].forEach(remove);
  const values = (node, keys) => {
    const style = win.getComputedStyle(node);
    return Object.fromEntries(keys.map((key) => [key, style[key]]));
  };
  const make = (svg, host) => {
    const recipe = iconMotion[svg.dataset.motionIcon]; if (!recipe) return null;
    const parts = new Map();
    for (const track of [...recipe.hover, ...recipe.press]) {
      const node = svg.querySelector(`[data-part="${track.part}"]`); if (!node) continue;
      const keys = [...new Set(track.frames.flatMap(Object.keys).filter((k) => k !== "offset"))];
      const part = parts.get(track.part) || { node, keys: [], base: {} };
      const fresh = keys.filter((key) => !part.keys.includes(key));
      part.base = { ...part.base, ...values(node, fresh) }; part.keys.push(...fresh); parts.set(track.part, part);
    }
    const record = { svg, host, recipe, parts, slots: new Map(), phase: "rest", generation: 0, hovered: false };
    active.set(svg, record); return record;
  };
  const playTrack = (record, track, kind) => {
    const part = record.parts.get(track.part); if (!part) return Promise.resolve();
    const previous = record.slots.get(track.part);
    if (kind === "hover" && previous?.kind === "hover") return Promise.resolve();
    const current = values(part.node, part.keys);
    previous?.animation.cancel();
    let frames = track.frames.map((frame, i) => ({ ...frame, offset: .12 + .88 * (frame.offset ?? (track.frames.length === 1 ? 1 : i / (track.frames.length - 1))) }));
    if (track.turn) {
      const matrix = new win.DOMMatrix(current.transform === "none" ? undefined : current.transform);
      const degrees = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
      current.transform = `rotate(${degrees}deg)`;
      frames = [{ transform: `rotate(${degrees + track.turn}deg)`, offset: 1 }];
    }
    // Story loops get a short live-frame handoff first, then their own seamless
    // timeline. They never rerender React and stop when the pointer leaves.
    const animation = part.node.animate(track.loop ? [current, track.frames[0]] : [{ ...current, offset: 0 }, ...frames], {
      duration: track.loop ? 150 : track.duration, delay: track.delay || 0, easing: track.easing || easeOut, fill: "forwards",
    });
    const slot = { animation, kind }; record.slots.set(track.part, slot);
    return animation.finished.catch(() => {}).then(() => {
      if (record.slots.get(track.part) !== slot || active.get(record.svg) !== record) return;
      if (track.loop && record.hovered && !blocked(record.host)) {
        const loop = part.node.animate(track.frames, { duration: track.duration, easing: track.easing, fill: "both", iterations: Infinity });
        slot.animation.cancel(); slot.animation = loop;
      }
    });
  };
  const hover = (record) => {
    record.phase = "hover"; record.svg.dataset.iconPhase = "hover";
    record.recipe.hover.forEach((track) => playTrack(record, track, "hover"));
  };
  const exit = (record) => {
    if (record.phase === "exit") return;
    record.phase = "exit"; record.hovered = false; const generation = ++record.generation;
    record.svg.dataset.iconPhase = "exit"; delete record.svg.dataset.iconEngaged;
    const waits = [...record.parts].map(([name, part]) => {
      const current = values(part.node, part.keys); record.slots.get(name)?.animation.cancel();
      const animation = part.node.animate([current, part.base], { duration: 220, easing: easeOut, fill: "forwards" });
      record.slots.set(name, { animation, kind: "exit" }); return animation.finished.catch(() => {});
    });
    Promise.all(waits).then(() => { if (active.get(record.svg) === record && record.generation === generation) remove(record); });
  };
  const play = (event, pressed = false) => {
    if (root.hidden || reduced.matches || (!pressed && (!fine.matches || event.pointerType === "touch"))) return;
    if (pressed && (event.button !== 0 || event.isPrimary === false)) return;
    const host = owner(event.target); if (blocked(host)) return;
    if (!pressed && owner(event.relatedTarget) === host) return;
    for (const svg of host.querySelectorAll("svg[data-motion-icon]")) {
      if (owner(svg) !== host || svg.closest(".spin")) continue;
      const record = active.get(svg) || make(svg, host); if (!record) continue;
      record.hovered = event.pointerType !== "touch" && fine.matches;
      record.svg.dataset.iconAnimating = "true"; record.svg.dataset.iconEngaged = "true";
      if (record.phase === "press") continue;
      if (!pressed) { ++record.generation; hover(record); continue; }
      record.phase = "press"; record.svg.dataset.iconPhase = "press"; const generation = ++record.generation;
      Promise.all(record.recipe.press.map((track) => playTrack(record, track, "press"))).then(() => {
        if (active.get(svg) !== record || generation !== record.generation) return;
        if (record.hovered && !blocked(host)) {
          // Press-only effects return to baseline before the hover pose resumes.
          for (const [name, slot] of record.slots) if (slot.kind === "press" && !record.recipe.hover.some((t) => t.part === name)) {
            const part = record.parts.get(name); playTrack(record, { part: name, frames: [part.base], duration: 180 }, "reset");
          }
          hover(record);
        } else exit(record);
      });
    }
  };
  const over = (e) => play(e), down = (e) => play(e, true);
  const out = (event) => {
    const host = owner(event.target); if (!host || owner(event.relatedTarget) === host) return;
    for (const record of active.values()) if (record.host === host) exit(record);
  };
  const visibility = () => { if (root.hidden) clear(); };
  const listeners = [["pointerover", over], ["pointerout", out], ["pointerdown", down, true], ["keydown", clear, true], ["pointercancel", clear], ["dragstart", clear], ["visibilitychange", visibility]];
  listeners.forEach(([name, fn, capture]) => root.addEventListener(name, fn, capture));
  win.addEventListener("blur", clear); reduced.addEventListener("change", clear);
  const observer = new win.MutationObserver(() => {
    for (const record of active.values()) if (!record.svg.isConnected || blocked(record.host)) remove(record);
  });
  observer.observe(root.documentElement || root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "aria-disabled", "aria-busy"] });
  return () => { clear(); observer.disconnect(); listeners.forEach(([name, fn, capture]) => root.removeEventListener(name, fn, capture)); win.removeEventListener("blur", clear); reduced.removeEventListener("change", clear); };
}
