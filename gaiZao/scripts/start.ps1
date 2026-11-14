# VelAgent 一键启动（单应用）：启动品牌化 DeepSeek Harness（内置 ui-velagent 插件），
# 只启动一个进程、一个端口（2021），并自动打开带 token 的页面。
# 画布 / 代码 / 试运行都在这个页面里，点右上角「⚡ VelAgent 电路」进入，
# 不需要再启动第二个服务或第二个窗口。
#
# 用法：双击 start.cmd，或在本目录执行  .\start.ps1
#       .\start.ps1 -NoOpen   只启动不打开浏览器（排障用）
param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptsDir)
$harness = $repoRoot
$port = 2021
$stateDir = Join-Path $env:APPDATA 'Enrui\VelAgent'
$urlFile = Join-Path $stateDir 'web-url.txt'
$logFile = Join-Path $stateDir 'web-server.log'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function Open-AppUrl {
  if (-not (Test-Path $urlFile)) {
    Write-Host "尚未记录启动地址：请先通过 start.cmd 启动一次，之后即可一键打开。"
    return
  }
  $url = (Get-Content $urlFile -Raw).Trim()
  if ($url) {
    Write-Host "打开：$url"
    if (-not $NoOpen) { Start-Process $url }
  }
}

# 已在运行：只打开页面（保证只启动一个）
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  Write-Host "VelAgent 已在运行（端口 $port）。"
  Open-AppUrl
  exit 0
}

$bin = Join-Path $harness 'apps\cli\lib\bin.js'
if (-not (Test-Path $bin)) {
  throw "找不到 Harness 构建产物：$bin（请先在仓库根目录运行 pnpm build）"
}

$dshHome = Join-Path $stateDir 'data\harness-home'
$env:DSH_HOME = $dshHome
$env:DSH_AGENTS_HOME = Join-Path $dshHome "agents"
$env:DSH_CLIENT_TITLE = 'VelAgent'

# 复用本机 DeepSeek 凭证：优先环境变量，其次 %APPDATA%\Enrui\VelAgent\api-key.txt
$keyFile = Join-Path $stateDir 'api-key.txt'
$legacyKeyFile = Join-Path $env:TEMP 'dsh-key.txt'
if (-not $env:DEEPSEEK_API_KEY) {
  if (Test-Path $keyFile) {
    $env:DEEPSEEK_API_KEY = (Get-Content $keyFile -Raw).Trim()
  } elseif (Test-Path $legacyKeyFile) {
    $env:DEEPSEEK_API_KEY = (Get-Content $legacyKeyFile -Raw).Trim()
    Set-Content -Path $keyFile -Value $env:DEEPSEEK_API_KEY -NoNewline
  }
}
if ($env:DEEPSEEK_API_KEY) {
  Write-Host "已载入 DeepSeek 凭证（复用本机 Key）。"
} else {
  Write-Host "提示：未找到 DeepSeek API Key，AI 对话/试运行会报 no API key；可在页面 设置→模型 填写，或设置 DEEPSEEK_API_KEY 后重启。"
}

Set-Content -Path $logFile -Value "" -NoNewline

Write-Host "启动 VelAgent（DeepSeek Harness + 内置画布插件），端口 $port ..."
$startArgs = @{
  FilePath = 'node'
  ArgumentList = @($bin, '--profile', 'web', '--port', $port, '--no-open')
  WorkingDirectory = $harness
  RedirectStandardOutput = $logFile
  RedirectStandardError = (Join-Path $stateDir 'web-server.err.log')
  WindowStyle = 'Hidden'
  PassThru = $true
}
$process = Start-Process @startArgs

# 等启动日志给出带 token 的地址
$url = $null
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Path $logFile) {
    $match = Select-String -Path $logFile -Pattern 'dsh web: (http://\S+)' | Select-Object -Last 1
    if ($match) { $url = $match.Matches[0].Groups[1].Value; break }
  }
  if ($process.HasExited) { break }
}
if (-not $url) {
  Write-Host "启动日志没有给出地址，请查看 $logFile"
  exit 1
}
Set-Content -Path $urlFile -Value $url -NoNewline
Write-Host "VelAgent 已启动：$url"
if (-not $NoOpen) { Start-Process $url }
