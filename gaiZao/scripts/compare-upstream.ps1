# compare-upstream.ps1 - 只读对比官方更新，绝对不合并。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/compare-upstream.ps1
#   ... -NoFetch        只用本地已有的 official/master，不联网
#
# 输出：gaiZao/docs/upstream-reports/upstream-<时间>.md（同时打印摘要）
# 注意：本脚本只读，不修改 dev/master，不自动同步任何东西。
param([switch]$NoFetch)
$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptsDir)
Set-Location $repoRoot

if (-not $NoFetch) {
  Write-Host 'fetching official (read-only) ...'
  git fetch official --tags 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'WARN: 拉取官方失败（网络/代理），使用本地已有的 official/master 快照。' -ForegroundColor Yellow
  }
}

$base = (git rev-parse master).Trim()
$upstream = (git rev-parse official/master).Trim()
$newCommits = @(git log --format='%h|%ad|%an|%s' --date=short "$base..official/master")
$changed = @(git diff --name-status "$base..official/master")

$ourOutside = @(git diff --name-only master..dev | Where-Object { $_ -and $_ -notlike 'gaiZao/*' })
$patchFiles = @{}
Get-ChildItem 'gaiZao\patches' -Filter '*.diff' -File | ForEach-Object {
  $patch = $_
  foreach ($line in Get-Content $patch.FullName) {
    if ($line -match '^diff --git a/(.+?) b/') { $patchFiles[$Matches[1]] = $patch.Name }
  }
}

$overlap = @()
$gaiZaoTouched = @()
$changedPaths = @()
foreach ($row in $changed) {
  $parts = $row -split ([char]9)
  if ($parts.Count -lt 2) { continue }
  $p = $parts[1]
  $changedPaths += $p
  if ($p -like 'gaiZao/*') { $gaiZaoTouched += $p }
  if ($ourOutside -contains $p) {
    $owner = if ($patchFiles.ContainsKey($p)) { $patchFiles[$p] } else { 'UNREGISTERED' }
    $overlap += [pscustomobject]@{ Path = $p; Patch = $owner }
  }
}

$reportDir = Join-Path $repoRoot 'gaiZao\docs\upstream-reports'
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$reportPath = Join-Path $reportDir ('upstream-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.md')

$lines = @()
$lines += '# 官方更新对比报告'
$lines += ''
$lines += '- 生成时间：' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
$lines += '- 我们的基线（官方镜像 master）：`' + $base + '`'
$lines += '- 官方最新（official/master）：`' + $upstream + '`'
$lines += '- 官方新增提交：**' + $newCommits.Count + '**；改动文件：**' + $changedPaths.Count + '**'
$lines += ''
$lines += '> 本报告只读生成，没有修改任何分支。是否采纳、采纳哪些，由人评估后决定。'
$lines += ''
$lines += '## 1. 官方新增提交'
$lines += ''
if ($newCommits.Count -eq 0) {
  $lines += '（无新提交，已是最新）'
} else {
  $lines += '| 提交 | 日期 | 作者 | 标题 |'
  $lines += '| --- | --- | --- | --- |'
  foreach ($c in $newCommits) {
    $f = $c -split '\|'
    $title = $f[3] -replace '\|', '/'
    $lines += '| `' + $f[0] + '` | ' + $f[1] + ' | ' + $f[2] + ' | ' + $title + ' |'
  }
}
$lines += ''
$lines += '## 2. 官方改动文件清单'
$lines += ''
$lines += '```'
foreach ($row in $changed) { $lines += $row }
$lines += '```'
$lines += ''
$lines += '## 3. 与我们的登记补丁重叠（升级时最可能冲突）'
$lines += ''
if ($overlap.Count -eq 0) {
  $lines += '（无重叠）'
} else {
  $lines += '| 官方改动的文件 | 我们的补丁 |'
  $lines += '| --- | --- |'
  foreach ($o in $overlap) { $lines += '| `' + $o.Path + '` | ' + $o.Patch + ' |' }
}
$lines += ''
$lines += '## 4. 官方是否动到 gaiZao/'
$lines += ''
if ($gaiZaoTouched.Count -eq 0) {
  $lines += '（没有，正常）'
} else {
  foreach ($p in $gaiZaoTouched) { $lines += '- `' + $p + '`' }
}
$lines += ''
$lines += '## 5. 选择性采纳（推荐做法）'
$lines += ''
$lines += '评估后只挑需要的提交，逐个 cherry-pick 到 dev：'
$lines += ''
$lines += '```powershell'
$lines += 'powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/apply-upstream.ps1 -Commits <sha1>,<sha2>'
$lines += '```'
$lines += ''
$lines += '不要整包 merge；除非明确决定全量跟进（apply-upstream.ps1 -FullMerge -ConfirmFullMerge）。'
Set-Content -Path $reportPath -Value ($lines -join [Environment]::NewLine) -Encoding UTF8

Write-Host ''
Write-Host ('官方新增提交：' + $newCommits.Count + ' 个；改动文件：' + $changedPaths.Count + ' 个')
Write-Host ('与登记补丁重叠：' + $overlap.Count + ' 个；官方动到 gaiZao/：' + $gaiZaoTouched.Count + ' 个')
Write-Host ('报告：' + $reportPath)
Write-Host '（只读对比，没有做任何合并/同步）'
