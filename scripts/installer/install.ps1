$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')
Set-StrictMode -Version 2
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Notice([string]$text, [bool]$failed = $false) {
  if ($env:ASS_INSTALL_DIR -or $env:ASS_INSTALL_SILENT) { Write-Output $text; return }
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($text, 'ASS Setup', 'OK', $(if ($failed) { 'Error' } else { 'Information' }))
}
function PlainPath([string]$file) {
  $cursor = [IO.Path]::GetFullPath($file)
  while ($cursor) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation path contains a link' }
    $parent = [IO.Path]::GetDirectoryName($cursor); if ($parent -eq $cursor) { break }; $cursor = $parent
  }
}
try {
  $bundle = Get-Content -LiteralPath 'manifest.json' -Raw | ConvertFrom-Json
  if ($bundle.appId -ne 'local.ass.desktop' -or $bundle.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid installation manifest' }
  if ((Get-FileHash -LiteralPath 'payload.zip' -Algorithm SHA256).Hash.ToLowerInvariant() -ne $bundle.payloadSha256) { throw 'Installation payload checksum mismatch' }
  $portable = $env:ASS_INSTALL_PORTABLE -eq '1'
  $base = $(if ($env:ASS_INSTALL_DIR) { $env:ASS_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\ASS' })
  if (![IO.Path]::IsPathRooted($base)) { throw 'Installation directory must be absolute' }
  $base = [IO.Path]::GetFullPath($base); PlainPath $base
  $rootMarker = Join-Path $base 'installation.json'
  if ((Test-Path -LiteralPath $base) -and (Get-ChildItem -LiteralPath $base -Force | Select-Object -First 1)) {
    if (!(Test-Path -LiteralPath $rootMarker) -or (Get-Content -LiteralPath $rootMarker -Raw | ConvertFrom-Json).appId -ne 'local.ass.desktop') { throw 'Existing directory is not an ASS installation' }
  }
  New-Item -ItemType Directory -Path $base -Force | Out-Null
  if (!(Test-Path -LiteralPath $rootMarker)) {
    @{ appId = 'local.ass.desktop'; portable = $portable } | ConvertTo-Json | Set-Content -LiteralPath $rootMarker -Encoding UTF8
  }
  $versions = Join-Path $base 'versions'; $target = Join-Path $versions ('v' + $bundle.version)
  PlainPath $target
  if (Test-Path -LiteralPath $target) {
    $old = Join-Path $target 'resources\app.asar'
    if (!(Test-Path -LiteralPath $old) -or (Get-FileHash -LiteralPath $old -Algorithm SHA256).Hash.ToLowerInvariant() -ne $bundle.asarSha256) { throw 'Installed version differs; refusing overwrite' }
  } else {
    New-Item -ItemType Directory -Path $versions -Force | Out-Null
    $stage = Join-Path $versions ('.install-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    $archive = [IO.Compression.ZipFile]::OpenRead((Join-Path (Get-Location) 'payload.zip'))
    try {
      foreach ($entry in $archive.Entries) {
        $resolved = [IO.Path]::GetFullPath((Join-Path $stage $entry.FullName))
        if (!$resolved.StartsWith($stage + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid payload entry path' }
      }
    } finally { $archive.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path (Get-Location) 'payload.zip'), $stage)
    if ((Get-FileHash -LiteralPath (Join-Path $stage 'resources\app.asar') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $bundle.asarSha256) { throw 'Extracted application checksum mismatch' }
    $files = @(Get-ChildItem -LiteralPath $stage -File -Recurse | ForEach-Object { $_.FullName.Substring($stage.Length + 1) })
    @{ appId = 'local.ass.desktop'; version = $bundle.version; files = $files } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'installed-files.json') -Encoding UTF8
    # Both resolved paths are checked under the explicitly selected install root.
    if (!$stage.StartsWith($versions + '\', [StringComparison]::OrdinalIgnoreCase) -or !$target.StartsWith($versions + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid installation move' }
    Move-Item -LiteralPath $stage -Destination $target
  }
  Copy-Item -LiteralPath 'uninstall.ps1' -Destination (Join-Path $base 'uninstall.ps1') -Force
  if (!$portable) {
    $env:ASS_SHORTCUT_SPEC = ''
    & ([ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path (Get-Location) 'identity.ps1'))))
    $programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'; $link = Join-Path $programs 'ASS.lnk'
    $shell = New-Object -ComObject WScript.Shell
    if (Test-Path -LiteralPath $link) {
      $previous = $shell.CreateShortcut($link)
      if ([AssAppIdentity]::GetShortcut($link) -ne 'local.ass.desktop' -or [IO.Path]::GetFileName($previous.TargetPath) -ne 'ASS.exe' -or $previous.Arguments) { throw 'Start menu shortcut belongs to another application' }
    }
    New-Item -ItemType Directory -Path $programs -Force | Out-Null
    $tempLink = Join-Path $programs ('.ASS-' + [Guid]::NewGuid().ToString('N') + '.lnk')
    $shortcut = $shell.CreateShortcut($tempLink); $shortcut.TargetPath = Join-Path $target 'ASS.exe'
    $shortcut.WorkingDirectory = $target; $shortcut.Description = 'ASS'; $shortcut.IconLocation = (Join-Path $target 'resources\ass.ico') + ',0'; $shortcut.Save()
    [AssAppIdentity]::SetShortcut($tempLink, 'local.ass.desktop')
    Move-Item -LiteralPath $tempLink -Destination $link -Force
    $uninstall = Join-Path $base 'uninstall.ps1'; $quoted = $uninstall.Replace("'", "''")
    $command = 'powershell.exe -NoProfile -Command "& ([ScriptBlock]::Create([IO.File]::ReadAllText(''' + $quoted + ''')))"'
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\local.ass.desktop'
    New-Item -Path $key -Force | Out-Null
    foreach ($entry in @{ DisplayName = 'ASS'; DisplayVersion = $bundle.version; Publisher = 'CaT-Hode'; InstallLocation = $base; DisplayIcon = (Join-Path $target 'resources\ass.ico'); UninstallString = $command }.GetEnumerator()) {
      New-ItemProperty -LiteralPath $key -Name $entry.Key -Value $entry.Value -PropertyType String -Force | Out-Null
    }
  }
  @{ appId = 'local.ass.desktop'; version = $bundle.version; portable = $portable; target = $target } | ConvertTo-Json | Set-Content -LiteralPath $rootMarker -Encoding UTF8
  Notice ('ASS ' + $bundle.version + ' installed. Open ASS from the Start menu.')
  exit 0
} catch {
  Notice $_.Exception.Message $true
  exit 1
}
