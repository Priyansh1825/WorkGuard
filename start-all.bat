@echo off
title WorkGuard - Starting Server and Client Agent
echo ========================================================
echo   Starting WorkGuard Server & Client Agent on Piyu...
echo ========================================================

:: Start Server in a separate window
start "WorkGuard Server (Port 3000)" cmd /k "cd /d %~dp0\server && node src\index.js"

:: Wait 2 seconds for server to initialize
timeout /t 2 /nobreak >nul

:: Start Client Agent in a separate window
start "WorkGuard Client Agent (Piyu)" cmd /k "cd /d %~dp0\client && node src\agent.js"

echo.
echo Both Server and Client Agent have been started!
echo Open dashboard at: http://localhost:3000
echo.
pause
