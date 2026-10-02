async function write(res, value) {
  if (res.destroyed) throw Error('客户端已断开');
  if (res.write(value)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => { res.off('drain', drain); res.off('close', close); res.off('error', error); };
    const drain = () => { cleanup(); resolve(); };
    const close = () => { cleanup(); reject(Error('客户端已断开')); };
    const error = e => { cleanup(); reject(e); };
    res.once('drain', drain); res.once('close', close); res.once('error', error);
    if (res.destroyed) close();
  });
}
module.exports = { write };
