@echo off
title WorkGuard - Safe Local Sandbox Test

echo ========================================================
echo   WorkGuard - Isolated Local Sandbox Test Environment
echo ========================================================
echo.

echo [1/3] Checking Port 3000 Availability...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Cleaning up previous process on port 3000 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo [2/3] Starting WorkGuard Admin Desktop Station...
set HOST=127.0.0.1
set PORT=3000
set NODE_ENV=development
start "WorkGuard Admin Desktop" /D "%~dp0admin" cmd /c "npm.cmd start"

echo Waiting for Admin Station to boot...
timeout /t 3 /nobreak >nul

echo [3/3] Starting WorkGuard Client Agent...
set SERVER_HOST=127.0.0.1
set SERVER_PORT=3000
set AUTO_DISCOVER=false
start "WorkGuard Client Agent" /D "%~dp0client" cmd /k "node.exe src\agent.js"

echo.
echo ========================================================
echo [SUCCESS] Sandbox Test Running!
echo.
echo - Admin Desktop Window is opening now.
echo - Client Agent console is active.
echo - Loopback 127.0.0.1 mode active (Zero network exposure).
echo ========================================================
echo.
pause
