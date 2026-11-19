@echo off
rem VelAgent 单应用启动入口：双击即可（内部调用 start.ps1）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 pause
