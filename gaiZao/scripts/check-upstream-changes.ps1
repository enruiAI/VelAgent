# check-upstream-changes.ps1 - verify every out-of-gaiZao change is registered.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/check-upstream-changes.ps1
#   ... -Explain     also print the diff of files vs registered patch coverage
#
# Compares "git diff --name-only master..dev" against the upstream files touched by
# gaiZao/patches/*.diff. Every changed file outside gaiZao/ must be covered.
param([switch]$Explain)
$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptsDir)
Set-Location $repoRoot

$changed = @(git diff --name-only master..dev | Where-Object { $_ -and ($_ -notlike 'gaiZao/*') })
$registered = @{}
Get-ChildItem 'gaiZao\patches' -Filter '*.diff' -File | ForEach-Object {
  $patch = $_
  foreach ($line in Get-Content $patch.FullName) {
    if ($line -match '^diff --git a/(.+?) b/') {
      $registered[$Matches[1]] = $patch.Name
    }
  }
}

$missing = @($changed | Where-Object { -not $registered.ContainsKey($_) })
if ($Explain) {
  Write-Host ('changed outside gaiZao: ' + $changed.Count)
  foreach ($file in $changed) {
    $owner = if ($registered.ContainsKey($file)) { $registered[$file] } else { 'UNREGISTERED' }
    Write-Host ('  ' + $file + '  <-  ' + $owner)
  }
}
if ($missing.Count -gt 0) {
  Write-Host 'FAIL: unregistered upstream changes:' -ForegroundColor Red
  foreach ($file in $missing) { Write-Host ('  ' + $file) }
  Write-Host 'Register a patch under gaiZao/patches (diff + PATCHES.md row) or revert the change.'
  exit 1
}
Write-Host 'OK: every change outside gaiZao/ is covered by a registered patch.'
exit 0
