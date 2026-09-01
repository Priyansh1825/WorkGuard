@echo off
title WorkGuard Anti-Tamper Agent Watchdog
cd /d "%~dp0\..\client"
echo =======================================================
echo   WorkGuard Self-Healing Watchdog Daemon Active
echo =======================================================
node src\watchdog.js
pause
