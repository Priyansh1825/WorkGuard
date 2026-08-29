@echo off
title WorkGuard Server
echo Starting WorkGuard Offline Monitoring Server...
cd /d "%~dp0\server"
node src\index.js
pause
