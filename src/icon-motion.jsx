import { useEffect } from "react";
import { attachIconMotion } from "./icon-player.mjs";

// Transient animation state stays outside React; one listener set per window.
export function useIconMotion() {
  useEffect(() => attachIconMotion(document), []);
}
