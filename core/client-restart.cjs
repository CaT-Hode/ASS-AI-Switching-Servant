// Optional desktop restart, scoped to verified installation + process identities.
// Discovery is read-only. No name-only taskkill and no replay of command lines.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { runPowerShell } = require("./client-processes.cjs");
const fingerprint = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const PS_INVENTORY = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$apps = @()
if (@($request.ids) -contains 'codex') {
  foreach ($package in @(Get-AppxPackage -Name 'OpenAI.Codex')) {
    $manifest = Get-AppxPackageManifest -Package $package
    $entry = @($manifest.Package.Applications.Application | Where-Object { $_.Id -eq 'App' })
    if ($entry.Count -ne 1) { continue }
    $exe = [IO.Path]::GetFullPath((Join-Path $package.InstallLocation ([string]$entry[0].Executable)))
    if (-not $exe.StartsWith($package.InstallLocation + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
    if (Test-Path -LiteralPath $exe -PathType Leaf) {
      $apps += [pscustomobject]@{ id='codex'; name='Codex 桌面端'; exe=$exe; aumid=([string]$package.PackageFamilyName + '!App') }
    }
  }
}
if (@($request.ids) -contains 'opencode' -and $request.opencode -and (Test-Path -LiteralPath $request.opencode -PathType Leaf)) {
  $apps += [pscustomobject]@{ id='opencode'; name='OpenCode Desktop'; exe=[string]$request.opencode; aumid=$null }
}
$rows = @(Get-CimInstance Win32_Process | ForEach-Object {
  [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; exe=[string]$_.ExecutablePath; created=if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null } }
})
[pscustomobject]@{ apps=@($apps); rows=@($rows) } | ConvertTo-Json -Depth 5 -Compress
`;
const PS_STOP = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$all = @(Get-CimInstance Win32_Process)
$map = @{}; foreach ($row in $all) { $map[[string][int]$row.ProcessId] = $row }
$wanted = @{}; foreach ($t in @($request.targets)) { $wanted[[string][int]$t.pid] = $t }
foreach ($t in @($request.targets)) {
  $row = $map[[string][int]$t.pid]
  if (-not $row -or -not $row.CreationDate -or [int]$t.pid -eq [int]$request.ownerPid -or [int]$t.pid -eq $PID -or
      $row.CreationDate.ToUniversalTime().ToString('o') -ne [string]$t.created -or
      [string]$row.ExecutablePath -ne [string]$t.exe -or [int]$row.ParentProcessId -ne [int]$t.parentPid) { throw 'identity-changed' }
}
foreach ($row in $all) {
  if ($wanted.ContainsKey([string][int]$row.ParentProcessId) -and -not $wanted.ContainsKey([string][int]$row.ProcessId)) { throw 'new-child' }
}
foreach ($t in @($request.targets | Sort-Object depth -Descending)) {
  $row = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$t.pid)
  if (-not $row) { continue }
  if (-not $row.CreationDate -or $row.CreationDate.ToUniversalTime().ToString('o') -ne [string]$t.created -or [string]$row.ExecutablePath -ne [string]$t.exe) { throw 'identity-changed' }
  $proc = Get-Process -Id ([int]$t.pid) -ErrorAction Stop
  $handle = $proc.Handle
  $again = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$t.pid)
  if (-not $again) { continue }
  if ($again.CreationDate.ToUniversalTime().ToString('o') -ne [string]$t.created -or [string]$again.ExecutablePath -ne [string]$t.exe) { throw 'identity-changed' }
  if (@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + [int]$t.pid) | Where-Object {
    $_.CreationDate -and $_.CreationDate.ToUniversalTime() -ge [DateTime]::Parse([string]$t.created).ToUniversalTime()
  }).Count) { throw 'child-still-running' }
  $proc.Kill()
  if (-not $proc.WaitForExit(2000)) { throw 'still-alive' }
}
[pscustomobject]@{ stopped=$true } | ConvertTo-Json -Compress
`;
const PS_LAUNCH = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
foreach ($app in @($request.apps)) {
  if ($app.aumid) {
    if ([string]$app.aumid -notmatch '^OpenAI\.Codex_[A-Za-z0-9]+!App$') { throw 'invalid-entry' }
    Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList @('shell:AppsFolder\' + [string]$app.aumid) -WindowStyle Hidden
  } else {
    # This is the interactive client explicitly selected for relaunch, not a background helper.
    Start-Process -FilePath ([string]$app.exe) -WorkingDirectory (Split-Path -Parent ([string]$app.exe)) -WindowStyle Normal
  }
}
[pscustomobject]@{ launched=$true } | ConvertTo-Json -Compress
`;
class DesktopRestartAdapter {
  async inventory(ids, opencode) { return (await runPowerShell(PS_INVENTORY, { ids, opencode }))[0]; }
  async stop(targets) { return (await runPowerShell(PS_STOP, { targets, ownerPid: process.pid }))[0]; }
  async launch(apps) { return (await runPowerShell(PS_LAUNCH, { apps }))[0]; }
}
class ClientRestart {
  constructor({ adapter = new DesktopRestartAdapter(), desktop = () => null, ownerPid = process.pid,
    fileInfo = (file) => { const s = fs.statSync(file); if (!s.isFile()) throw Error(); return [s.size, s.mtimeMs]; },
    wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    Object.assign(this, { adapter, desktop, ownerPid, fileInfo, wait });
  }
  async capture(ids) {
    const eligible = ids.filter((id) => ["codex", "opencode"].includes(id));
    if (!eligible.length) return { apps: [], targets: [] };
    const data = await this.adapter.inventory(eligible, eligible.includes("opencode") ? this.desktop("opencode") : null);
    if (!data || !Array.isArray(data.apps) || !Array.isArray(data.rows)) throw Error("无法识别客户端进程");
    const byPid = new Map(data.rows.map((r) => [r.pid, r]));
    if (byPid.size !== data.rows.length) throw Error("进程清单不一致");
    const apps = [], targets = new Map();
    for (const app of data.apps) {
      if (!eligible.includes(app.id) || !path.isAbsolute(app.exe) || apps.some((a) => a.id === app.id)) throw Error("客户端安装入口不明确");
      const matches = data.rows.filter((r) => r.exe?.toLowerCase() === app.exe.toLowerCase());
      const roots = matches.filter((r) => !matches.some((p) => p.pid === r.parentPid));
      if (!roots.length) continue;
      apps.push({ ...app, file: this.fileInfo(app.exe) });
      const visit = (row, depth, ancestors = new Set()) => {
        if (ancestors.has(row.pid) || depth > 64 || row.pid === this.ownerPid ||
          !Number.isSafeInteger(row.pid) || row.pid <= 0 || !Number.isFinite(Date.parse(row.created)) || !path.isAbsolute(row.exe))
          throw Error("进程身份无法确认，或此客户端承载 ASS，请手动重启");
        targets.set(row.pid, { pid: row.pid, parentPid: row.parentPid, exe: row.exe, created: row.created, depth });
        for (const child of data.rows.filter((r) => r.parentPid === row.pid)) {
          if (Date.parse(child.created) < Date.parse(row.created)) throw Error("进程身份已变化");
          visit(child, depth + 1, new Set([...ancestors, row.pid]));
        }
      };
      for (const root of roots) visit(root, 0);
    }
    return { apps: apps.sort((a, b) => a.id.localeCompare(b.id)), targets: [...targets.values()].sort((a, b) => a.pid - b.pid) };
  }
  async preview(ids) {
    const applicable = ids.some((id) => ["codex", "opencode"].includes(id));
    if (!applicable) return { applicable: false, available: false };
    try {
      const value = await this.capture(ids);
      return { applicable, available: value.apps.length > 0, names: value.apps.map((a) => a.name),
        reason: value.apps.length ? "" : "未识别到可安全重启的桌面实例，请手动重启。", value, fingerprint: fingerprint(value), ids };
    } catch { return { applicable, available: false, reason: "进程或安装入口无法可靠确认，请手动重启。" }; }
  }
  public(plan) { return plan && { applicable: plan.applicable, available: plan.available, names: plan.names || [], reason: plan.reason || "" }; }
  async validate(plan) {
    if (!plan?.available || fingerprint(await this.capture(plan.ids)) !== plan.fingerprint) throw Error("客户端进程或安装入口已变化，请重新确认重启");
  }
  async restart(plan, beforeLaunch = () => {}) {
    await this.validate(plan);
    const stopped = await this.adapter.stop(plan.value.targets);
    if (stopped?.stopped !== true) throw Error("客户端未完整关闭，请手动重启");
    const remaining = await this.capture(plan.ids);
    if (remaining.targets.length) throw Error("仍检测到客户端进程，请手动确认后重启");
    for (const app of plan.value.apps) if (fingerprint(this.fileInfo(app.exe)) !== fingerprint(app.file)) throw Error("客户端安装已更新，请从开始菜单重启");
    beforeLaunch();
    const launched = await this.adapter.launch(plan.value.apps);
    if (launched?.launched !== true) throw Error("客户端启动失败，请手动打开");
    for (let i = 0; i < 10; i++) {
      await this.wait(500);
      const fresh = await this.capture(plan.ids);
      if (plan.value.apps.every((a) => fresh.apps.some((b) => a.id === b.id))) return { ok: true, names: plan.names };
    }
    throw Error("已发出启动请求，但未确认新进程，请检查客户端");
  }
}
module.exports = { ClientRestart, DesktopRestartAdapter };
