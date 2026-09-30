// Node consumers may contact only the synthetic local server. Native binaries
// additionally receive dead outbound proxies; this is not an OS firewall.
const net = require('node:net'), tls = require('node:tls');
const local = host => !host || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
for (const mod of [net, tls]) {
  const original = mod.connect;
  mod.connect = function(...args) {
    const o = args[0], host = typeof o === 'object' ? o.host || o.hostname : typeof args[1] === 'string' ? args[1] : undefined;
    if (!local(host)) throw Error('Native contract blocked nonlocal connection');
    return original.apply(this, args);
  };
}
if (global.fetch) {
  const original = global.fetch;
  global.fetch = (input, options) => {
    if (!local(new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname))
      throw Error('Native contract blocked nonlocal fetch');
    return original(input, options);
  };
}
