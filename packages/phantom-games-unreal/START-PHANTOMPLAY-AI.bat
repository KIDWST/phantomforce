@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Tools\PhantomPlayAI\Start-PhantomPlayAI.ps1"
if errorlevel 1 (
  echo.
  echo PhantomPlay AI stopped with an error.
  pause
)
