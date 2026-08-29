@echo off
title Packaging WorkGuard Suite...

echo =======================================================
echo 🚀 Packaging Complete WorkGuard Software Suite
echo =======================================================

call "%~dp0package-admin.bat"
call "%~dp0package-client.bat"
call "%~dp0package-inspector.bat"

echo =======================================================
echo 🎉 ALL 3 SOFTWARE PACKAGES CREATED IN '%~dp0dist\'
echo.
echo 1. Admin Package:     dist\WorkGuard-Admin-Station\
echo 2. Client Package:    dist\WorkGuard-Client-Agent\
echo 3. Inspector Package: dist\WorkGuard-Inspector\
echo =======================================================
