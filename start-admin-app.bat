@echo off
title Launching WorkGuard Admin Desktop App...
cd /d "%~dp0admin"
echo Starting WorkGuard Admin Desktop Station...
call npm.cmd start
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Admin App exited with code %ERRORLEVEL%.
    pause
)
