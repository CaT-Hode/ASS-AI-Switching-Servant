$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')
function PlainPath([string]$file) {
  $cursor = [IO.Path]::GetFullPath($file)
  while ($cursor) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked uninstall path' }
    $parent = [IO.Path]::GetDirectoryName($cursor); if ($parent -eq $cursor) { break }; $cursor = $parent
  }
}
try {
  # The uninstall command runs this source as a ScriptBlock, so derive the root
  # from the verified per-user registration. Portable installs supply their destination.
  $portable = $env:ASS_INSTALL_PORTABLE -eq '1'
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\local.ass.desktop'
  $base = $(if ($portable) { $env:ASS_INSTALL_DIR } else { (Get-ItemProperty -LiteralPath $key).InstallLocation })
  $base = [IO.Path]::GetFullPath($base)
  PlainPath $base
  $marker = Get-Content -LiteralPath (Join-Path $base 'installation.json') -Raw | ConvertFrom-Json
  if ($marker.appId -ne 'local.ass.desktop') { throw 'Unrecognized installation' }
  $running = @(Get-CimInstance Win32_Process -Filter "Name='ASS.exe'" | Where-Object { !$_.ExecutablePath -or $_.ExecutablePath.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase) })
  if ($running.Count) { throw 'Exit ASS from the tray before uninstalling.' }
  $versions = Join-Path $base 'versions'
  foreach ($version in Get-ChildItem -LiteralPath $versions -Directory) {
    if ($version.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked installation directory' }
    $manifest = Join-Path $version.FullName 'installed-files.json'
    if (!(Test-Path -LiteralPath $manifest)) { continue }
    $record = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    if ($record.appId -ne 'local.ass.desktop') { continue }
    foreach ($relative in $record.files) {
      $file = [IO.Path]::GetFullPath((Join-Path $version.FullName $relative))
      if (!$file.StartsWith($version.FullName + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid uninstall file path' }
      PlainPath $file
      if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file }
    }
    Remove-Item -LiteralPath $manifest
    foreach ($dir in @(Get-ChildItem -LiteralPath $version.FullName -Directory -Recurse | Sort-Object { $_.FullName.Length } -Descending) + @($version)) {
      if (!(Get-ChildItem -LiteralPath $dir.FullName -Force | Select-Object -First 1)) { [IO.Directory]::Delete($dir.FullName) }
    }
  }
  if (!$portable) {
    $link = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\ASS.lnk'
    if (Test-Path -LiteralPath $link) {
      $target = (New-Object -ComObject WScript.Shell).CreateShortcut($link).TargetPath
      if ($target.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $link }
    }
    if ((Get-ItemProperty -LiteralPath $key).InstallLocation -eq $base) { Remove-Item -LiteralPath $key }
  }
  Remove-Item -LiteralPath (Join-Path $base 'installation.json')
  Remove-Item -LiteralPath (Join-Path $base 'uninstall.ps1')
  if (!(Get-ChildItem -LiteralPath $versions -Force | Select-Object -First 1)) { [IO.Directory]::Delete($versions) }
  if (!(Get-ChildItem -LiteralPath $base -Force | Select-Object -First 1)) { [IO.Directory]::Delete($base) }
  # Electron data in AppData/Roaming/ASS and all client accounts are preserved.
  exit 0
} catch { Write-Error $_.Exception.Message; exit 1 }
