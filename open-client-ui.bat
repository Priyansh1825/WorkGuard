@echo off
title WorkGuard - Employee Workstation Hub
echo Opening WorkGuard Employee Hub...
start msedge.exe --app="http://127.0.0.1:38282" --window-size=520,640 || start "" "http://127.0.0.1:38282"
