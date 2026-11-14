# sync-main-snapshot.ps1 - 把默认分支 main 刷成 dev 的单提交快照。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/sync-main-snapshot.ps1
#   ... -DryRun     只生成并显示 commit，不移动/推送 main
#   ... -NoPush     移动本地 main，但不推送远端
#
# 目的：默认分支 main 只保留一个快照提交（Contributors 页面只显示仓库 owner），
# 完整官方历史保留在 dev / master 分支，不删除、不改写。
#
# 合规约束（脚本会自检，缺一不可）：
#   1. LICENSE + gaiZao/licenses/** 的许可证与 NOTICE 必须存在于快照树中；
#   2. README 顶部必须保留“基于 DeepSeek Harness（MIT）/ Velxio（AGPLv3）”的来源说明；
#   3. 快照 commit message 写明上游基线 commit，明确这是衍生作品快照；
#   4. dev / master 分支保持完整历史，不因本脚本而删除。
param([switch]$DryRun, [switch]$NoPush)
$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptsDir)
Set-Location $repoRoot

$dirty = @(git status --porcelain)
if ($dirty.Count -gt 0) { throw '工作区不干净，请先 commit/stash（快照必须来自已提交的 dev）' }

$devSha = (git rev-parse dev).Trim()
$upstreamBase = (git rev-parse master).Trim()
$tree = (git rev-parse ($devSha + '^{tree}')).Trim()

$required = @(
  'LICENSE',
  'README.md',
  'gaiZao/licenses/AGPL-3.0.txt',
  'gaiZao/licenses/deepseekharness/LICENSE',
  'gaiZao/licenses/deepseekharness/NOTICE.md',
  'gaiZao/licenses/deepseekharness/THIRD_PARTY_NOTICES.md',
  'gaiZao/licenses/velxio/LICENSE',
  'gaiZao/licenses/velxio/NOTICE.md',
  'gaiZao/licenses/velxio/COMMERCIAL_LICENSE.md'
)
foreach ($f in $required) {
  git cat-file -e ($devSha + ':' + $f) 2>$null
  if ($LASTEXITCODE -ne 0) { throw ('快照缺少许可证/声明文件：' + $f + '（合规检查失败，已中止）') }
}
$readme = (git show ($devSha + ':README.md')) -join [Environment]::NewLine
if ($readme -notmatch 'DeepSeek Harness') { throw 'README 缺少对 DeepSeek Harness（MIT）的来源说明，已中止' }
if ($readme -notmatch 'AGPL') { throw 'README 缺少 AGPLv3 许可证说明，已中止' }
Write-Host '合规检查通过：许可证、NOTICE、README 来源说明都在。'

$nl = [Environment]::NewLine
$message = @(
  'VelAgent snapshot (default branch)',
  '',
  'VelAgent is a derivative work of DeepSeek Harness (MIT, Copyright DeepSeek AI)',
  'with the Velxio UI rewrite (AGPLv3, Copyright David Monterocrespo).',
  'The whole work is distributed under AGPLv3; see LICENSE and gaiZao/licenses/.',
  '',
  'Upstream baseline commit (official mirror): ' + $upstreamBase,
  'Source branch: dev @ ' + $devSha,
  'Full upstream history is kept on the dev and master branches; this branch is',
  'a presentation snapshot only.'
) -join $nl

# 提交链接到仓库 owner 的 GitHub 账号（ID+login 的 noreply 邮箱）
$env:GIT_AUTHOR_NAME = 'enruiAI'
$env:GIT_AUTHOR_EMAIL = '342860024+enruiAI@users.noreply.github.com'
$env:GIT_COMMITTER_NAME = 'enruiAI'
$env:GIT_COMMITTER_EMAIL = '342860024+enruiAI@users.noreply.github.com'
$commit = ($message | git commit-tree $tree).Trim()
Remove-Item Env:GIT_AUTHOR_NAME, Env:GIT_AUTHOR_EMAIL, Env:GIT_COMMITTER_NAME, Env:GIT_COMMITTER_EMAIL -ErrorAction SilentlyContinue

Write-Host ('snapshot commit: ' + $commit.Substring(0, 12) + '  (upstream base ' + $upstreamBase.Substring(0, 8) + ', dev ' + $devSha.Substring(0, 8) + ')')
if ($DryRun) { Write-Host 'DryRun：未移动 main'; exit 0 }

git branch -f main $commit
Write-Host 'local main -> snapshot commit'

if (-not $NoPush) {
  $env:GIT_HTTP_VERSION = 'HTTP/1.1'
  $refspec = $commit + ':refs/heads/main'
  Write-Host 'pushing main snapshot ...'
  $pushOk = $false
  $proxy = 'http://127.0.0.1:7897'
  $hasProxy = $false
  try { $hasProxy = Test-NetConnection 127.0.0.1 -Port 7897 -WarningAction SilentlyContinue -InformationLevel Quiet } catch { $hasProxy = $false }

  if ($hasProxy) {
    Write-Host ('using local proxy ' + $proxy)
    & git -c http.proxy=$proxy push --force origin $refspec
    if ($LASTEXITCODE -eq 0) { $pushOk = $true }
  }
  if (-not $pushOk) {
    & git push --force origin $refspec
    if ($LASTEXITCODE -eq 0) { $pushOk = $true }
  }
  if (-not $pushOk) { throw 'push main failed（分支已本地更新，可稍后重试）' }
  Write-Host 'main snapshot pushed.'
}

Write-Host ''
Write-Host '完成。dev / master 的完整上游历史未改动；下次 dev 有更新后重跑本脚本刷新 main。'

exit 0
