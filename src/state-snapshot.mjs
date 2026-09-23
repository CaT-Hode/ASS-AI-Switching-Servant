// Background OAuth updates and IPC results can arrive in a different order.
export function latestSnapshot(current, next) {
  return current && Number.isFinite(current.sequence) && Number.isFinite(next?.sequence) && current.sequence > next.sequence ? current : next;
}
