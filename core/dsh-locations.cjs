// Read declared launcher paths; never run a shell, a client, or a key helper.
const fs = require('node:fs'), path = require('node:path');
const { safePath } = require('./native-fields.cjs');
const { memoRead } = require('./read-scope.cjs');
const key = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
function plain(file) {
  try {
    safePath(file); const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= 65536 ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') : '';
  } catch { return ''; }
}
function expand(value, base, home, env, shell, quoted) {
  let missing = false;
  const variable = name => {
    const result = name.toUpperCase() === 'HOME' ? env.HOME || home
      : Object.entries(env).find(([id]) => process.platform === 'win32' ? id.toLowerCase() === name.toLowerCase() : id === name)?.[1];
    if (typeof result !== 'string' || !result) { missing = true; return ''; }
    return result;
  };
  if (shell === 'cmd') value = value.replace(/%~dp0/gi, base + path.sep).replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_, id) => variable(id));
  else if (quoted !== "'") {
    value = value.replace(/\$\{PSScriptRoot\}|\$PSScriptRoot\b/gi, base)
      .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, id) => variable(id))
      .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, a, b) => variable(a || b));
  }
  if (shell === 'sh' && !quoted) value = value.replace(/^~(?=[/\\]|$)/, home);
  if (missing || !value || value.length > 4096 || /[\r\n\0`%$<>|*?]/.test(value) || !path.isAbsolute(value)) return null;
  return path.resolve(value);
}
function declaredHome(file, home, env) {
  const ext = path.extname(file).toLowerCase(), shell = ['.cmd', '.bat'].includes(ext) ? 'cmd' : ext === '.ps1' ? 'powershell' : 'sh';
  if (!['.cmd', '.bat', '.ps1', '.sh', ''].includes(ext)) return {};
  const text = plain(file), values = [];
  let declared = false, overwritesEnv = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(?:rem\b|::|#)/i.test(line)) continue;
    let match, raw, quote;
    if (shell === 'cmd') {
      match = /^\s*@?(?:if\s+not\s+defined\s+DSH_HOME\s+)?set\s+(?:"DSH_HOME=([^"]*)"|DSH_HOME=([^&|<>]+?))\s*$/i.exec(line);
      raw = match?.[1] ?? match?.[2];
      const assignment = /\bset\s+"?DSH_HOME=/i.test(line);
      declared ||= assignment;
      if (assignment && !/^\s*@?if\s+not\s+defined\s+DSH_HOME\s+/i.test(line)) overwritesEnv = true;
      if (assignment && !overwritesEnv && env.DSH_HOME) continue;
      if (assignment && !match) values.push(null);
    } else if (shell === 'powershell') {
      match = /^\s*\$env:DSH_HOME\s*=\s*(['"])(.*?)\1\s*(?:#.*)?$/i.exec(line);
      raw = match?.[2]; quote = match?.[1];
      const assignment = /\$env:DSH_HOME\s*=/i.test(line); declared ||= assignment; overwritesEnv ||= assignment;
      if (assignment && !match) values.push(null);
    } else {
      match = /^\s*(?:export\s+)?DSH_HOME=(?:(['"])(.*?)\1|([^\s#]+))\s*(?:#.*)?$/.exec(line);
      raw = match?.[2] ?? match?.[3]; quote = match?.[1];
      const assignment = /\bDSH_HOME=/.test(line); declared ||= assignment; overwritesEnv ||= assignment;
      if (assignment && !match) values.push(null);
    }
    if (raw !== undefined) values.push(expand(raw.trim(), path.dirname(file), home, env, shell, quote));
  }
  const unique = [...new Set(values.filter(Boolean).map(key))];
  if (declared && !overwritesEnv && env.DSH_HOME && !values.length) return { declared: true, dir: env.DSH_HOME, overwritesEnv: false };
  if (declared && (values.includes(null) || unique.length !== 1)) return { declared: true, issue: 'DSH 启动器的数据目录无法静态确认，请在客户端设置中指定凭据目录' };
  return unique.length ? { declared: true, dir: values.find(v => key(v) === unique[0]), overwritesEnv } : {};
}
function hasState(dir) {
  try {
    safePath(dir);
    return ['.credentials.yaml', 'settings.yaml', 'profiles', 'desktop-link', 'dsh-app'].some(name => fs.existsSync(path.join(dir, name)));
  } catch { return false; }
}
function resolveHomes({ home, env = {}, override, launcher = {} }) {
  const fallback = path.join(home, '.dsh'), candidates = [override];
  let issue = '';
  if (launcher.ready) {
    const entry = launcher.entryPoint || launcher.executable;
    const declared = entry ? declaredHome(entry, home, env) : {};
    issue = declared.issue || '';
    if (declared.dir) candidates.push(...(declared.overwritesEnv ? [declared.dir, env.DSH_HOME] : [env.DSH_HOME, declared.dir]));
    else if (!declared.declared) {
      const roots = [];
      try { if (launcher.location && fs.statSync(launcher.location).isDirectory()) roots.push(launcher.location); } catch {}
      if (entry) {
        const parent = path.dirname(entry); roots.push(parent);
        if (['bin', '.bin'].includes(path.basename(parent))) roots.push(path.dirname(parent));
        if (path.basename(parent) === '.bin' && path.basename(path.dirname(parent)) === 'node_modules') roots.push(path.resolve(parent, '../..'));
      }
      const portable = [...new Map(roots.map(root => [key(root), root])).values()].map(root => path.join(root, '.dsh')).filter(hasState);
      if (portable.length === 1) candidates.push(env.DSH_HOME, portable[0]);
      else if (portable.length > 1) issue = 'DSH 安装目录存在多个数据目录，请在客户端设置中指定凭据目录';
    }
  }
  const seen = new Set(), dirs = [...candidates, env.DSH_HOME, fallback].filter(value => typeof value === 'string' && !!value.trim())
    .map(value => path.resolve(value.replace(/^~(?=[/\\]|$)/, home)))
    .filter(dir => { const id = key(dir); if (seen.has(id)) return false; seen.add(id); return true; });
  return { dirs, issue: override ? '' : issue };
}
function locations(options) {
  const launcher = options.launcher || {};
  return memoRead(locations, [options.home, options.env, options.override, launcher.ready, launcher.entryPoint, launcher.executable, launcher.location], () => resolveHomes(options));
}
module.exports = { locations, declaredHome };
