@echo off
setlocal
cd /d "%~dp0"
title WorkGuard LAN Workstation Reconnect Hub

echo ==============================================================
echo  WorkGuard LAN Remote Workstation Reconnect Hub
echo ==============================================================
echo.
echo  [1] Quick Scan ^& Attempt Auto-Wakeup (Default)
echo  [2] Scan ^& Wakeup using Remote Administrator Credentials
echo  [3] Scan Only (Diagnostics)
echo.
set /p CHOICE=" Select option [1-3] (Default: 1): "

if "%CHOICE%"=="2" (
    echo.
    echo Prompting for Windows Administrator credentials...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0lan-reconnect.ps1' -Credential (Get-Credential)"
) else if "%CHOICE%"=="3" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lan-reconnect.ps1" -ScanOnly
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lan-reconnect.ps1"
)

echo.
pause
