# apply-upstream.ps1 - 按需采纳官方更新（默认只允许选择性 cherry-pick）。
#
#   # 1) 先看只读对比报告
#   powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/compare-upstream.ps1
#
#   # 2) 评估后只挑需要的提交（推荐）
#   powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/apply-upstream.ps1 -Commits <sha1>,<sha2>
#
#   # 3) 明确决定全量跟进时才用（危险，需要二次确认）
#   powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/apply-upstream.ps1 -FullMerge -ConfirmFullMerge
#
# 执行完会跑补丁登记检查（check-upstream-changes.ps1），并提示重新构建。
param(
  [string[]]$Commits = @(),
  [switch]$FullMerge,
  [switch]$ConfirmFullMerge,
  [switch]$NoPush
)
$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptsDir)
Set-Location $repoRoot

if (-not $FullMerge -and $Commits.Count -eq 0) {
  Write-Host '未指定要采纳的内容。本仓库默认不自动同步：' -ForegroundColor Yellow
  Write-Host '  1) 生成只读对比报告： -File gaiZao/scripts/compare-upstream.ps1'
  Write-Host '  2) 选择性采纳：       -File gaiZao/scripts/apply-upstream.ps1 -Commits <sha1>,<sha2>'
  Write-Host '  3) 全量跟进（不推荐）：-FullMerge -ConfirmFullMerge'
  exit 0
}

$dirty = @(git status --porcelain)
if ($dirty.Count -gt 0) { throw '工作区不干净，请先 commit/stash' }

if ($FullMerge) {
  if (-not $ConfirmFullMerge) { throw '全量跟进需要显式加 -ConfirmFullMerge（默认禁止自动同步）' }
  Write-Host 'full merge：master 快进到官方，再合并到 dev ...' -ForegroundColor Yellow
  git fetch official --tags
  if ($LASTEXITCODE -ne 0) { throw 'git fetch official failed' }
  git checkout master
  git merge --ff-only official/master
  if ($LASTEXITCODE -ne 0) { throw 'master 不是干净的官方镜像' }
  git checkout dev
  git merge master
  if ($LASTEXITCODE -ne 0) { throw '合并有冲突，解决后运行 check-upstream-changes.ps1' }
} else {
  Write-Host ('选择性 cherry-pick：' + ($Commits -join ' '))
  git checkout dev
  foreach ($c in $Commits) {
    git cherry-pick $c
    if ($LASTEXITCODE -ne 0) {
      Write-Host ('cherry-pick ' + $c + ' 冲突：解决后 git cherry-pick --continue，再运行 check-upstream-changes.ps1') -ForegroundColor Yellow
      exit 1
    }
  }
}

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-upstream-changes.ps1')
if ($LASTEXITCODE -ne 0) { throw '越界改动未登记，先补补丁再继续' }

if (-not $NoPush) {
  git add -A
  $pending = @(git status --porcelain)
  if ($pending.Count -gt 0) {
    git -c user.name='VelAgent' -c user.email='velagent@enrui.local' commit -m 'chore(upstream): re-apply registered patches after selective upstream update'
  }
  # 公开仓库只接收 main 快照；dev/master 留在本地（需要云备份用 push-velagent.ps1 -ArchiveRemote）
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-main-snapshot.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'main snapshot failed' }
}

Write-Host ''
Write-Host '采纳完成。建议重新构建并自检：'
Write-Host '  pnpm install; pnpm build; node gaiZao/scripts/build-features.mjs'
Write-Host '  node gaiZao/scripts/verify-canvas-bridge.mjs'
