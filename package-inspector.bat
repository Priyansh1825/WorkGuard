@echo off
setlocal enabledelayedexpansion
title Packaging WorkGuard Inspector...

set "DIST_DIR=%~dp0dist\WorkGuard-Inspector"
set "SRC_DIR=%~dp0inspector"

echo =======================================================
echo Building WorkGuard Network ^& Fleet Inspector Package
echo =======================================================

if exist "%DIST_DIR%" rmdir /s /q "%DIST_DIR%"
mkdir "%DIST_DIR%"

echo [1/4] Copying Web Diagnostic Engine...
copy /y "%SRC_DIR%\index.html" "%DIST_DIR%\" >nul
copy /y "%SRC_DIR%\style.css" "%DIST_DIR%\" >nul
copy /y "%SRC_DIR%\renderer.js" "%DIST_DIR%\" >nul
copy /y "%SRC_DIR%\inspector_server.js" "%DIST_DIR%\" >nul

echo [2/4] Compiling Native Windows Executable (WorkGuard-Inspector.exe)...
set "CSC_EXE=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC_EXE%" set "CSC_EXE=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"

if exist "%CSC_EXE%" (
    "%CSC_EXE%" /target:winexe /out:"%DIST_DIR%\WorkGuard-Inspector.exe" /reference:System.Windows.Forms.dll "%SRC_DIR%\InspectorLauncher.cs" >nul 2>&1
)

echo [3/4] Creating 1-Click Launchers...
(
echo @echo off
echo title WorkGuard Network ^& Fleet Inspector
echo if exist WorkGuard-Inspector.exe start "" "WorkGuard-Inspector.exe"
echo if not exist WorkGuard-Inspector.exe start "" index.html
) > "%DIST_DIR%\inspect-network.bat"

echo [4/4] Creating Zip Archive...
powershell -Command "Compress-Archive -Path '%DIST_DIR%' -DestinationPath '%~dp0dist\WorkGuard-Inspector.zip' -Force" >nul 2>&1

echo [SUCCESS] Inspector Package Complete: dist\WorkGuard-Inspector\
echo =======================================================
