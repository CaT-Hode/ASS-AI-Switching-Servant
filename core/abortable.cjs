// Some fetch implementations abort the request but leave response body reads
// pending. Bound the caller independently; still pass the signal to the I/O.
function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
module.exports = { abortable };
