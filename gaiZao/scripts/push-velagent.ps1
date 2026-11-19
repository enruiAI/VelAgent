# push-velagent.ps1 - 发布到公开仓库（只推 main 快照）。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/push-velagent.ps1
#   ... -ArchiveRemote archive   同时把完整历史 (master/dev) 推到备份仓库
#
# 公开仓库 enruiAI/VelAgent 只保留 main 快照（1 个提交），这样 Contributors 只有 owner。
# 完整官方历史保留在本地 dev/master；需要云端备份时用 -ArchiveRemote 指定另一个仓库。
param([string]$ArchiveRemote = '')
$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptsDir)
Set-Location $repoRoot
$env:GIT_HTTP_VERSION = 'HTTP/1.1'

if ($ArchiveRemote -ne '') {
  Write-Host ('archiving full history to ' + $ArchiveRemote + ' ...')
  git push $ArchiveRemote master dev
  if ($LASTEXITCODE -ne 0) { throw 'archive push failed' }
}

Write-Host 'publishing main snapshot to origin ...'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-main-snapshot.ps1')
if ($LASTEXITCODE -ne 0) { throw 'main snapshot failed' }

Write-Host 'verifying remote refs ...'
git ls-remote origin refs/heads/main
Write-Host 'done. Public repo: main = single-commit snapshot (dev/master stay local/archive).'
