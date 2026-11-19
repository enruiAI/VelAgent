# sync-upstream.ps1 - 已停用自动同步，仅作兼容入口。
#
# 本仓库不会自动同步官方。推荐流程：
#   1) gaiZao/scripts/compare-upstream.ps1   只读对比，生成报告
#   2) 人工评估要跟进哪些提交
#   3) gaiZao/scripts/apply-upstream.ps1 -Commits <sha...>  只采纳需要的
#
# 若要全量跟进（不推荐）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/apply-upstream.ps1 -FullMerge -ConfirmFullMerge
param([switch]$FullMerge, [switch]$ConfirmFullMerge)
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($FullMerge) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'apply-upstream.ps1') -FullMerge -ConfirmFullMerge:$ConfirmFullMerge
  exit $LASTEXITCODE
}
Write-Host '已禁用自动同步。请先运行只读对比：' -ForegroundColor Yellow
Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/compare-upstream.ps1'
Write-Host '然后按需 cherry-pick：'
Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/apply-upstream.ps1 -Commits <sha1>,<sha2>'
