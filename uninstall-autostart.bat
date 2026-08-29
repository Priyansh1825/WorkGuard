@echo off
title WorkGuard - Remove Auto-Start
echo ===================================================================
echo   WorkGuard: Remove Client Agent from Windows Auto-Start
echo ===================================================================
echo.

del /f /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\WorkGuardAgent.lnk" 2>nul

echo [DONE] Auto-start shortcut removed from Windows Startup.
echo.
pause
