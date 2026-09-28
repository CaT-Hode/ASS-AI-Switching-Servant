import { useEffect, useRef } from "react";

// A short release accent remains visible after a quick click. CSS transitions
// retarget from their current shape; repeated clicks never restart keyframes.
export function useIconMotion() {
  const timers = useRef(new Map());
  useEffect(() => () => {
    for (const [node, timer] of timers.current) { clearTimeout(timer); delete node.dataset.iconPulse; }
    timers.current.clear();
  }, []);
  return (event) => {
    if (event.detail === 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const node = event.target.closest?.("button, summary");
    if (!node || node.matches(":disabled, .theme-toggle") || !node.querySelector("svg.lucide")) return;
    clearTimeout(timers.current.get(node));
    node.dataset.iconPulse = "true";
    timers.current.set(node, setTimeout(() => { delete node.dataset.iconPulse; timers.current.delete(node); }, 240));
  };
}
