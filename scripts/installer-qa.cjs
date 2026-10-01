const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), { version } = require('../package.json');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ass-installer-')), destination = path.join(fixture, '安装 测试');
const exe = path.join(root, 'release', `ASS-v${version}-win32-x64-setup.exe`);
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const shortcut = path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/ASS.lnk'), shortcutBefore = hash(shortcut);
const registration = () => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\local.ass.desktop'; if(Test-Path -LiteralPath $k){ (Get-ItemProperty -LiteralPath $k | Select-Object DisplayName,DisplayVersion,InstallLocation,UninstallString) | ConvertTo-Json -Compress }"], { encoding: 'utf8', windowsHide: true }).trim();
const registrationBefore = registration(), env = { ...process.env, ASS_INSTALL_DIR: destination, ASS_INSTALL_SILENT: '1', ASS_INSTALL_PORTABLE: '1' };
const contents = path.join(fixture, 'contents'); fs.mkdirSync(contents);
const extracted = spawnSync(exe, ['/Q', '/C', '/T:' + contents], { windowsHide: true, timeout: 90000 });
assert.equal(extracted.status, 0);
assert.deepEqual(fs.readdirSync(contents).sort(), ['identity.ps1','install.ps1','manifest.json','payload.zip','setup.cmd','uninstall.ps1']);
for (const name of ['install.ps1', 'uninstall.ps1'])
  assert.equal(hash(path.join(contents, name)), hash(path.join(__dirname, 'installer', name)));
assert.equal(hash(path.join(contents, 'identity.ps1')), hash(path.join(__dirname, 'windows-app-identity.ps1')));
const bundle = JSON.parse(fs.readFileSync(path.join(contents, 'manifest.json'), 'utf8'));
assert.equal(hash(path.join(contents, 'payload.zip')), bundle.payloadSha256);
const installed = spawnSync(exe, ['/Q', '/R:N'], { env, windowsHide: true, timeout: 90000, encoding: 'utf8' });
assert.equal(installed.status, 0, installed.stderr || installed.error?.message);
const marker = JSON.parse(fs.readFileSync(path.join(destination, 'installation.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(marker.version, version); assert.equal(marker.portable, true);
const asar = path.join(marker.target, 'resources/app.asar');
assert.equal(hash(asar), hash(path.join(root, 'release', 'v' + version, 'ASS-win32-x64/resources/app.asar')));
const unknown = path.join(marker.target, 'user-added.txt'); fs.writeFileSync(unknown, 'preserve unknown content');
const repaired = spawnSync(exe, ['/Q', '/R:N'], { env, windowsHide: true, timeout: 90000 }); assert.equal(repaired.status, 0);
assert.equal(fs.readFileSync(unknown, 'utf8'), 'preserve unknown content');
execFileSync(process.execPath, [path.join(__dirname, 'package-qa.cjs')], { env: { ...process.env, ASS_TEST_EXECUTABLE: path.join(marker.target, 'ASS.exe') }, stdio: 'inherit' });
const uninstaller = path.join(destination, 'uninstall.ps1');
const removed = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:ASS_QA_UNINSTALL)))"],
  { env: { ...env, ASS_QA_UNINSTALL: uninstaller }, windowsHide: true, timeout: 60000, encoding: 'utf8' });
assert.equal(removed.status, 0, removed.stderr); assert.equal(fs.existsSync(asar), false); assert.equal(fs.readFileSync(unknown, 'utf8'), 'preserve unknown content');
const foreign = path.join(fixture, 'foreign'); fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'keep.txt'), 'foreign content');
spawnSync(exe, ['/Q', '/R:N'], { env: { ...env, ASS_INSTALL_DIR: foreign }, windowsHide: true, timeout: 90000 });
assert.equal(fs.readFileSync(path.join(foreign, 'keep.txt'), 'utf8'), 'foreign content'); assert.equal(fs.existsSync(path.join(foreign, 'versions')), false);
assert.equal(hash(shortcut), shortcutBefore); assert.equal(registration(), registrationBefore);
console.log(JSON.stringify({ fixture, installer: 'passed', payloadFiles: 6, isolatedInstall: true, repair: true, installedAppLaunch: true,
  uninstallPreservesUnknownFiles: true, foreignDirectoryRejected: true, realShortcutAndRegistrationUnchanged: true }));
