import { useEffect, useRef } from "react";
import { moveVisible } from "./provider-order.mjs";

export function useProviderDrag({ ids, visibleIds, onReorder, disabled }) {
  const current = useRef(null);
  function clear() {
    const drag = current.current;
    if (!drag) return;
    current.current = null;
    drag.node.classList.remove("dragging");
    drag.node.style.removeProperty("transform");
    drag.target?.classList.remove("drop-target");
    if (drag.handle.hasPointerCapture(drag.pointer))
      drag.handle.releasePointerCapture(drag.pointer);
  }
  useEffect(() => {
    const key = (event) => {
      if (event.key === "Escape") clear();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", clear);
    return () => {
      clear();
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", clear);
    };
  }, [visibleIds.join("\0")]);
  return (id) => ({
    disabled,
    onClick: (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    onPointerDown: (event) => {
      if (event.button !== 0 || disabled) return;
      clear();
      event.preventDefault();
      const handle = event.currentTarget,
        node = handle.closest(".supplier-card");
      handle.focus();
      handle.setPointerCapture(event.pointerId);
      current.current = {
        id,
        handle,
        node,
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
    },
    onPointerMove: (event) => {
      const drag = current.current;
      if (!drag || drag.pointer !== event.pointerId) return;
      const x = event.clientX - drag.x,
        y = event.clientY - drag.y;
      if (!drag.started && Math.hypot(x, y) < 6) return;
      drag.started = true;
      drag.node.classList.add("dragging");
      drag.node.style.transform = `translate(${x}px, ${y}px)`;
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest(".supplier-card");
      drag.target?.classList.remove("drop-target");
      drag.target =
        target &&
        visibleIds.includes(target.dataset.providerId) &&
        target.dataset.providerId !== id
          ? target
          : null;
      drag.target?.classList.add("drop-target");
    },
    onPointerUp: () => {
      const drag = current.current,
        target = drag?.target?.dataset.providerId;
      clear();
      if (drag?.started && target)
        onReorder(moveVisible(ids, visibleIds, id, target));
    },
    onPointerCancel: clear,
    onLostPointerCapture: clear,
    onKeyDown: (event) => {
      if (
        disabled ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      )
        return;
      event.preventDefault();
      const cols = getComputedStyle(
        event.currentTarget.closest(".supplier-grid"),
      ).gridTemplateColumns.split(" ").length;
      const delta = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -cols,
        ArrowDown: cols,
      }[event.key];
      const target = visibleIds[visibleIds.indexOf(id) + delta];
      if (target) onReorder(moveVisible(ids, visibleIds, id, target));
    },
  });
}
