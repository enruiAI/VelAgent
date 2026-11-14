# install-velagent.ps1 - install the global 'velagent' launcher (idempotent).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/install-velagent.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/install-velagent.ps1 -Uninstall
#
# The launcher starts this repository's dsh web (profile web, port 2021) with an
# isolated DSH_HOME. It never touches the official dsh command or its profile.
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'

$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptsDir)
$binDir = Join-Path $env:USERPROFILE '.velagent\bin'
$cmdPath = Join-Path $binDir 'velagent.cmd'
$launchPath = Join-Path $binDir 'launch.mjs'
$bin = Join-Path $repoRoot 'apps\cli\lib\bin.js'
$pluginPath = Join-Path $repoRoot 'gaiZao\features\velagent-workbench'
$stateDir = Join-Path $env:APPDATA 'Enrui\VelAgent'
$dshHome = Join-Path $stateDir 'data\harness-home'

function Remove-UserPathEntry([string]$dir) {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath) {
    $entries = @($userPath -split ';' | Where-Object { $_ -and $_ -ne $dir })
    [Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User')
  }
}

if ($Uninstall) {
  Remove-Item $cmdPath, $launchPath -Force -ErrorAction SilentlyContinue
  Remove-UserPathEntry $binDir
  if (Test-Path $bin) {
    $env:DSH_HOME = $dshHome
    $env:DSH_AGENTS_HOME = Join-Path $dshHome 'agents'
    & node $bin plugin --profile web remove velagent-workbench 2>&1 | Out-Null
  }
  Write-Host 'velagent launcher removed; official dsh untouched.'
  return
}

if (-not (Test-Path $bin)) {
  throw "missing build output: $bin (run pnpm install && pnpm build in the repository root first)"
}
foreach ($artifact in @('index.js', 'client.js', 'cordis.patch.yml')) {
  if (-not (Test-Path (Join-Path $pluginPath $artifact))) {
    throw "missing plugin artifact: $artifact (run: node gaiZao/scripts/build-features.mjs)"
  }
}

New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$env:DSH_HOME = $dshHome
$env:DSH_AGENTS_HOME = Join-Path $dshHome 'agents'

Write-Host 'installing velagent-workbench into dsh profile web ...'
& node $bin plugin --profile web add $pluginPath
if ($LASTEXITCODE -ne 0) { throw 'dsh plugin add failed' }

$launchCore = Join-Path $repoRoot 'gaiZao\scripts\launch-core.mjs'
$launchUrl = ([System.Uri]$launchCore).AbsoluteUri
$launchContent = "import('" + $launchUrl + "').then((m) => m.launch())" + [Environment]::NewLine
[System.IO.File]::WriteAllText($launchPath, $launchContent, (New-Object System.Text.ASCIIEncoding))

$cmdContent = '@echo off' + [Environment]::NewLine + 'node "%~dp0launch.mjs" %*' + [Environment]::NewLine
[System.IO.File]::WriteAllText($cmdPath, $cmdContent, (New-Object System.Text.ASCIIEncoding))

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @($userPath -split ';' | Where-Object { $_ })
if ($entries -notcontains $binDir) {
  [Environment]::SetEnvironmentVariable('Path', (($entries + $binDir) -join ';'), 'User')
  $env:Path = "$env:Path;$binDir"
}
Write-Host ''
Write-Host "installed: $cmdPath"
Write-Host 'open a new terminal and run: velagent'
