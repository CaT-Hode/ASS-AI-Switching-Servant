// Background OAuth updates and IPC results can arrive in a different order.
export function latestSnapshot(current, next) {
  if (current && Number.isFinite(current.sequence) && Number.isFinite(next?.sequence) && current.sequence >= next.sequence) return current;
  return shareUnchanged(current, next);
}

// IPC clones every object, even when only a spinner changed. Reuse unchanged
// branches so memoized usage summaries and model lists keep their identity.
export function shareUnchanged(previous, next) {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== "object" || typeof next !== "object" ||
      Array.isArray(previous) !== Array.isArray(next)) return next;
  const keys = Object.keys(next), oldKeys = Object.keys(previous);
  let same = keys.length === oldKeys.length && (!Array.isArray(next) || next.length === previous.length);
  let result = next;
  for (const key of keys) {
    const value = shareUnchanged(previous[key], next[key]);
    if (!Object.is(value, next[key])) {
      if (result === next) result = Array.isArray(next) ? next.slice() : { ...next };
      Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
    }
    if (!Object.hasOwn(previous, key) || !Object.is(value, previous[key])) same = false;
  }
  return same ? previous : result;
}
