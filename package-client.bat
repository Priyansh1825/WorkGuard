@echo off
setlocal enabledelayedexpansion
title Packaging WorkGuard Client Agent...

echo =======================================================
echo Building WorkGuard Client Agent Standalone Package
echo =======================================================

set DIST_DIR=%~dp0dist\WorkGuard-Client-Agent
if exist "%DIST_DIR%" rd /s /q "%DIST_DIR%"
mkdir "%DIST_DIR%"
mkdir "%DIST_DIR%\bin"
mkdir "%DIST_DIR%\src"
mkdir "%DIST_DIR%\storage_buffer"

echo [1/5] Compiling Hardware Acceleration Screen Bypass Engine...
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /optimize+ /target:exe /out:"%DIST_DIR%\bin\screengrab.exe" "%~dp0client\src\ScreenGrab.cs" >nul 2>&1
if not exist "%DIST_DIR%\bin\screengrab.exe" (
    echo Copying pre-compiled binary...
    copy "%~dp0client\bin\screengrab.exe" "%DIST_DIR%\bin\" /Y >nul
)

echo [2/5] Copying Client Source and Config Files...
copy "%~dp0client\src\*.js" "%DIST_DIR%\src\" /Y >nul
if exist "%~dp0client\src\ui" (
    xcopy "%~dp0client\src\ui" "%DIST_DIR%\src\ui\" /E /I /Q /Y >nul
)
copy "%~dp0client\config.json" "%DIST_DIR%\" /Y >nul
copy "%~dp0client\setup_autostart.js" "%DIST_DIR%\" /Y >nul
copy "%~dp0client\package.json" "%DIST_DIR%\" /Y >nul

echo [3/5] Copying Dependencies...
if exist "%~dp0client\node_modules" (
    xcopy "%~dp0client\node_modules" "%DIST_DIR%\node_modules\" /E /I /Q /Y >nul
)

echo [4/6] Compiling Native Windows Client Executables (.exe)...
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /optimize+ /target:winexe /out:"%DIST_DIR%\WorkGuard-Client.exe" "%~dp0client\ClientLauncher.cs" >nul 2>&1
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /optimize+ /target:winexe /r:System.Windows.Forms.dll /out:"%DIST_DIR%\Install-WorkGuard.exe" "%~dp0client\ClientInstaller.cs" >nul 2>&1
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /optimize+ /target:winexe /out:"%DIST_DIR%\Employee-Hub.exe" "%~dp0client\ClientHub.cs" >nul 2>&1

echo [5/6] Generating Launchers...

:: 1. Install-WorkGuard-Agent.bat
echo @echo off > "%DIST_DIR%\Install-WorkGuard-Agent.bat"
echo title Installing WorkGuard Client Agent... >> "%DIST_DIR%\Install-WorkGuard-Agent.bat"
echo start "" "%%~dp0Install-WorkGuard.exe" >> "%DIST_DIR%\Install-WorkGuard-Agent.bat"

:: 2. Uninstall-WorkGuard-Agent.bat
echo @echo off > "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"
echo title Uninstalling WorkGuard Client Agent... >> "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"
echo echo ======================================================= >> "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"
echo echo   WorkGuard Client Agent - Uninstaller >> "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"
echo echo ======================================================= >> "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"
echo echo. >> "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"
echo node setup_autostart.js uninstall >> "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"
echo taskkill /F /IM screengrab.exe /T 2^>nul >> "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"
echo echo. >> "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"
echo echo ======================================================= >> "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"
echo echo [SUCCESS] Autostart removed. >> "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"
echo echo ======================================================= >> "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"
echo pause >> "%DIST_DIR%\Uninstall-WorkGuard-Agent.bat"

:: 3. Start-Agent-Silent.vbs
echo Set WshShell = CreateObject("WScript.Shell"^) > "%DIST_DIR%\Start-Agent-Silent.vbs"
echo strCurDir = WshShell.CurrentDirectory >> "%DIST_DIR%\Start-Agent-Silent.vbs"
echo WshShell.Run "node """ ^& strCurDir ^& "\src\agent.js""", 0, False >> "%DIST_DIR%\Start-Agent-Silent.vbs"
echo Set WshShell = Nothing >> "%DIST_DIR%\Start-Agent-Silent.vbs"

:: 4. Start-Agent-Console.bat
echo @echo off > "%DIST_DIR%\Start-Agent-Console.bat"
echo title WorkGuard Client Agent [Debug Console] >> "%DIST_DIR%\Start-Agent-Console.bat"
echo echo Starting WorkGuard Agent with live output... >> "%DIST_DIR%\Start-Agent-Console.bat"
echo node src\agent.js --open-ui >> "%DIST_DIR%\Start-Agent-Console.bat"
echo pause >> "%DIST_DIR%\Start-Agent-Console.bat"

:: 5. Open-Employee-Hub.bat
echo @echo off > "%DIST_DIR%\Open-Employee-Hub.bat"
echo title WorkGuard - Employee Workstation Hub >> "%DIST_DIR%\Open-Employee-Hub.bat"
echo echo Opening WorkGuard Employee Hub... >> "%DIST_DIR%\Open-Employee-Hub.bat"
echo start msedge.exe --app="http://127.0.0.1:38282" --window-size=520,640 ^|^| start "" "http://127.0.0.1:38282" >> "%DIST_DIR%\Open-Employee-Hub.bat"

:: 6. README.txt
echo ======================================================= > "%DIST_DIR%\README.txt"
echo   WorkGuard Client Agent - Deployment Package >> "%DIST_DIR%\README.txt"
echo ======================================================= >> "%DIST_DIR%\README.txt"
echo. >> "%DIST_DIR%\README.txt"
echo INSTRUCTIONS: >> "%DIST_DIR%\README.txt"
echo 1. Copy this entire folder to the employee workstation. >> "%DIST_DIR%\README.txt"
echo 2. Double-click 'Install-WorkGuard-Agent.bat'. >> "%DIST_DIR%\README.txt"
echo 3. The agent will run silently in the background and auto-start on every Windows boot. >> "%DIST_DIR%\README.txt"
echo. >> "%DIST_DIR%\README.txt"
echo FEATURES: >> "%DIST_DIR%\README.txt"
echo - Hardware-accelerated GPU screen capture bypass [Chrome/Discord/Zoom/VS Code]. >> "%DIST_DIR%\README.txt"
echo - Zero-configuration UDP LAN Auto-Discovery [Port 38281]. >> "%DIST_DIR%\README.txt"
echo - Offline buffering when Admin is offline. >> "%DIST_DIR%\README.txt"

echo [5/6] Creating Zip Archive...
powershell -Command "Compress-Archive -Path '%DIST_DIR%\*' -DestinationPath '%~dp0dist\WorkGuard-Client-Agent.zip' -Force"

echo [6/6] Packaging Complete!
echo Folder: %DIST_DIR%
echo ZIP:    %~dp0dist\WorkGuard-Client-Agent.zip
