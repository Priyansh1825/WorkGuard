@echo off
title WorkGuard - Enable Auto-Start on Boot
echo ===================================================================
echo   WorkGuard: Register Client Agent to Start Automatically on Boot
echo ===================================================================
echo.

cd /d "%~dp0"
node client\setup_autostart.js

echo.
echo -------------------------------------------------------------------
echo  [DONE] The Client Agent is now configured for AUTO-START!
echo.
echo  * When the PC turns ON:  Agent launches silently in background.
echo  * When the PC turns OFF: Agent automatically closes with Windows.
echo -------------------------------------------------------------------
echo.
pause
