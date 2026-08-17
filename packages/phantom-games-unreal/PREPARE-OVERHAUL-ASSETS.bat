@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File ".\PREPARE-OVERHAUL-ASSETS.ps1"
