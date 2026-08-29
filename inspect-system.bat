@echo off
title WorkGuard - Network & Fleet Diagnostic Inspector
echo =======================================================
echo 🩺 Launching WorkGuard Network & Fleet Inspector...
echo =======================================================
echo.

start "WorkGuard Inspector" /D "%~dp0inspector" cmd /c "node.exe inspector_server.js"

echo Inspector is running at http://127.0.0.1:38283
echo Opening browser window...
timeout /t 2 /nobreak >nul
exit
