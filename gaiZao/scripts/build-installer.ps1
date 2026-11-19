# build-installer.ps1 - 构建 VelAgent Windows 安装包（未签名）。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/build-installer.ps1
#   ... -OutDir gaiZao/anZhuangBao/0.0.1   自定义交付目录（默认 anZhuangBao/<版本>）
#
# 前置条件：
#   1. apps/desktop/.env.windows 已配置（DSH_DESKTOP_APP_ID 等，见 .env.windows.example）；
#   2. 已安装 Visual C++ Build Tools + Windows SDK（安装器 UI 需要编译）；
#   3. 网络可访问 npm / nodejs.org / github release（Electron 包可预先放 .desktop-build/downloads 缓存）。
#
# 产物：apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/VelAgent-*-win-x64-unsigned.exe
param([string]$OutDir = '')
$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptsDir)
Set-Location $repoRoot
$env:GIT_HTTP_VERSION = 'HTTP/1.1'
if (-not (Test-Path 'apps/desktop/.env.windows')) {
  throw '缺少 apps/desktop/.env.windows：复制 apps/desktop/.env.windows.example 并填写 DSH_DESKTOP_APP_ID 等'
}

Write-Host 'building VelAgent Windows installer (unsigned) ...'
pnpm run package:desktop:win:x64:unsigned
if ($LASTEXITCODE -ne 0) { throw 'installer build failed' }

$exe = Get-ChildItem 'apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts' -Filter 'VelAgent-*-win-x64-unsigned.exe' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw 'installer artifact not found' }
if ($OutDir -eq '') { $OutDir = Join-Path 'gaiZao/anZhuangBao' ($exe.BaseName -replace '^VelAgent-([0-9.]+)-.*$', '$1') }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$target = Join-Path $OutDir $exe.Name
Copy-Item $exe.FullName $target -Force
$hash = (Get-FileHash $target -Algorithm SHA256).Hash
Set-Content -Path (Join-Path $OutDir 'SHA256.txt') -Value ('SHA256  ' + $exe.Name + '  ' + $hash) -Encoding ASCII
Write-Host ''
Write-Host ('installer: ' + (Resolve-Path $target).Path)
Write-Host ('sha256: ' + $hash)
