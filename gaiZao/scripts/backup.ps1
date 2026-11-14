# backup.ps1 - 备份完整历史（默认本地 bundle，不碰公开仓库）。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/backup.ps1
#   ... -ArchiveRemote archive   同时把 master/dev 和标签推到备份仓库
#
# 注意：公开仓库 enruiAI/VelAgent 只应保留 main 快照；不要把完整历史或标签推到 origin。
param([string]$ArchiveRemote = '', [string]$BundleDir = '')
$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptsDir)
Set-Location $repoRoot

$tag = 'backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
git tag $tag
if ($LASTEXITCODE -ne 0) { throw 'git tag failed' }

$backupDir = if ($BundleDir -ne '') { $BundleDir } else { Join-Path $env:USERPROFILE 'VelAgent-backups' }
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$file = Join-Path $backupDir ($tag + '.bundle')
git bundle create $file master dev main
if ($LASTEXITCODE -ne 0) { throw 'git bundle failed' }
Write-Host ('local bundle: ' + $file)

if ($ArchiveRemote -ne '') {
  git push $ArchiveRemote $tag
  if ($LASTEXITCODE -ne 0) { throw 'archive tag push failed' }
  git push $ArchiveRemote master dev
  if ($LASTEXITCODE -ne 0) { throw 'archive push failed' }
  Write-Host ('archived to ' + $ArchiveRemote)
} else {
  Write-Host '未推送到公开仓库（公开仓库只保留 main 快照）。'
}
