// Explicit production payload. Frontend dependencies are already bundled by Vite.
const runtimeDependencies = ['@iarna/toml', 'yaml', 'jsonc-parser'];
function allowed(name) {
  const n = name.replaceAll('\\', '/').replace(/^\//, '');
  if (!n || ['package.json', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'public', 'node_modules', 'node_modules/@iarna'].includes(n)) return true;
  if (/^(core|electron|dist)(\/|$)/.test(n))
    return !/(?:^|\/)(?:tests?|qa|fixtures?|__tests__|coverage)(?:\/|$)|\.(?:map|d\.ts)$/.test(n);
  if (n === 'public/ass-app-icon.png') return true;
  for (const dependency of runtimeDependencies) {
    const prefix = 'node_modules/' + dependency;
    if (n === prefix) return true;
    if (!n.startsWith(prefix + '/')) continue;
    const file = n.slice(prefix.length + 1);
    if (/^(?:package\.json|LICEN[CS]E(?:\.txt|\.md)?)$/i.test(file)) return true;
    if (dependency === '@iarna/toml') return /^(?:[^/]+\.js|lib(?:\/[^/]+\.js)?)$/.test(file);
    // YAML's runtime schema directory is named yaml-1.1; dots in directory
    // names are not source-map or type-definition extensions.
    if (dependency === 'yaml') return /^dist(?:\/.*)?$/.test(file) && !/\.(?:ts|map)$/.test(file);
    if (dependency === 'jsonc-parser') return /^(?:lib|lib\/umd|lib\/umd\/impl|lib\/umd\/(?:impl\/)?[^/]+\.js)$/.test(file);
  }
  return false;
}
function productionMain(source) {
  // Keep test controls in the checkout only; eliminate their branches in releases.
  const esbuild = require('esbuild');
  const input = source.replace('const testMode = process.argv.includes("--qa");', '')
    .replace('const customData = process.env.ASS_TEST_DATA;', '')
    .replace('let systemSession, directSession, testFetch;', 'let systemSession, directSession;');
  const result = esbuild.transformSync(input, { loader: 'js', minifySyntax: true,
    define: { testMode: 'false', customData: 'undefined' }, legalComments: 'inline' }).code;
  if (/ASS_TEST_|global\.assTest|--qa/.test(result)) throw Error('QA controls survived production build');
  return result;
}
module.exports = { allowed, productionMain, runtimeDependencies };
