@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Tools\Build-UnityBaselineSafety.ps1" -ProjectRoot "%~dp0"
if errorlevel 1 pause
