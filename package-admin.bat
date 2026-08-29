@echo off
setlocal enabledelayedexpansion
title Packaging WorkGuard Admin Station...

echo =======================================================
echo Building WorkGuard Admin Station (Electron JS) Package
echo =======================================================

set DIST_DIR=%~dp0dist\WorkGuard-Admin-Station
if exist "%DIST_DIR%" rd /s /q "%DIST_DIR%"
mkdir "%DIST_DIR%"
mkdir "%DIST_DIR%\admin"
mkdir "%DIST_DIR%\server"

echo [1/4] Copying Admin Electron Shell...
copy "%~dp0admin\main.js" "%DIST_DIR%\admin\" /Y >nul
copy "%~dp0admin\preload.js" "%DIST_DIR%\admin\" /Y >nul
copy "%~dp0admin\package.json" "%DIST_DIR%\admin\" /Y >nul
if exist "%~dp0admin\node_modules" (
    xcopy "%~dp0admin\node_modules" "%DIST_DIR%\admin\node_modules\" /E /I /Q /Y >nul
)

echo [2/4] Copying Server Backend and Web Assets...
copy "%~dp0server\package.json" "%DIST_DIR%\server\" /Y >nul
if exist "%~dp0server\src" (
    xcopy "%~dp0server\src" "%DIST_DIR%\server\src\" /E /I /Q /Y >nul
)
if exist "%~dp0server\public" (
    xcopy "%~dp0server\public" "%DIST_DIR%\server\public\" /E /I /Q /Y >nul
)
if exist "%~dp0server\node_modules" (
    xcopy "%~dp0server\node_modules" "%DIST_DIR%\server\node_modules\" /E /I /Q /Y >nul
)

echo [3/5] Compiling Native Windows Executable (WorkGuard-Admin.exe)...
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /optimize+ /target:winexe /r:System.Windows.Forms.dll /out:"%DIST_DIR%\WorkGuard-Admin.exe" "%~dp0admin\AdminLauncher.cs" >nul 2>&1

:: Start-Admin-Station.bat
echo @echo off > "%DIST_DIR%\Start-Admin-Station.bat"
echo title Starting WorkGuard Admin Desktop Station... >> "%DIST_DIR%\Start-Admin-Station.bat"
echo start "" "%%~dp0WorkGuard-Admin.exe" >> "%DIST_DIR%\Start-Admin-Station.bat"

:: README.txt
echo ======================================================= > "%DIST_DIR%\README.txt"
echo   WorkGuard Admin Station [Electron JS] >> "%DIST_DIR%\README.txt"
echo ======================================================= >> "%DIST_DIR%\README.txt"
echo. >> "%DIST_DIR%\README.txt"
echo INSTRUCTIONS: >> "%DIST_DIR%\README.txt"
echo 1. Double-click 'Start-Admin-Station.bat' (or 'Start-Admin-Station.vbs'). >> "%DIST_DIR%\README.txt"
echo 2. The native desktop monitoring window will open. >> "%DIST_DIR%\README.txt"
echo 3. The server starts on port 3000 and UDP discovery starts on port 38281. >> "%DIST_DIR%\README.txt"
echo 4. Workstation client agents on your LAN will automatically connect! >> "%DIST_DIR%\README.txt"

echo [4/5] Creating Zip Archive...
powershell -Command "Compress-Archive -Path '%DIST_DIR%\*' -DestinationPath '%~dp0dist\WorkGuard-Admin-Station.zip' -Force"

echo [5/5] Packaging Complete!
echo Folder: %DIST_DIR%
echo ZIP:    %~dp0dist\WorkGuard-Admin-Station.zip
