const { runPowerShell } = require('./client-processes.cjs');
// Read-only; closing clients is a human action, never an implicit delete step.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$running = @()
$patterns = @{
 codex = '(?i)(?:OpenAI[.]Codex|[\\/]codex(?:[.]exe|[.]js)?(?:["\s]|$))'
 claude = '(?i)(?:[\\/]claude[.]exe(?:["\s]|$)|[\\/]@anthropic-ai[\\/]claude-code[\\/])'
 dsh = '(?i)(?:[\\/]dsh(?:[.]exe|[.]js)?(?:["\s]|$)|@deepseek-ai[\\/]dsh|deepseek-harness[\\/].*(?:cli|desktop|dist))'
 opencode = '(?i)(?:[\\/]opencode(?:[.]exe|[.]js)?(?:["\s]|$)|opencode-ai[\\/])'
 pi = '(?i)(?:pi-coding-agent[\\/].*(?:cli|index)[.]js|[\\/]pi[.]exe(?:["\s]|$))'
}
foreach ($p in @(Get-CimInstance Win32_Process)) {
 if ([int]$p.ProcessId -eq [int]$request.ownerPid -or [int]$p.ProcessId -eq $PID) { continue }
 foreach ($h in @($request.harnesses)) {
  $value = [string]$p.ExecutablePath + ' ' + [string]$p.CommandLine
  $nativeName = ($h -eq 'codex' -and [string]$p.Name -match '^(?i)(codex|ChatGPT)[.]exe$') -or
    ($h -eq 'claude' -and [string]$p.Name -match '^(?i)claude[.]exe$') -or
    ($h -eq 'opencode' -and [string]$p.Name -match '^(?i)opencode[.]exe$')
  if ($nativeName -or ($patterns[$h] -and $value -match $patterns[$h])) { $running += [string]$h }
 }
}
[pscustomobject]@{ running=@($running | Select-Object -Unique) } | ConvertTo-Json -Compress
`;
async function assertDeletionIdle(rows, run = runPowerShell) {
  const harnesses = [...new Set(rows.map((r) => r.harness))];
  const response = await run(SCRIPT, { harnesses, ownerPid: process.pid });
  // The shared PowerShell adapter always returns a list, even when the script
  // emits one object. Unwrap exactly one result; never treat malformed output
  // or a failed inspection as proof that the client is closed.
  const result = Array.isArray(response) && response.length === 1 ? response[0] : response;
  if (!Array.isArray(result?.running) || result.running.some((h) => !harnesses.includes(h)))
    throw Error('未能确认客户端已关闭，未删除');
  if (result.running.length) {
    const names = { codex: 'Codex', claude: 'Claude / CC', dsh: 'DSH', opencode: 'OpenCode', pi: 'pi' };
    throw Error('请先关闭 ' + result.running.map((h) => names[h] || h).join('、') + '，再删除或恢复本地记录。');
  }
}
module.exports = { assertDeletionIdle };
