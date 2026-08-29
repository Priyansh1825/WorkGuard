@echo off
title WorkGuard Client Agent
echo Starting WorkGuard Silent Client Agent...
cd /d "%~dp0\client"
node src\agent.js
pause
