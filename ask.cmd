@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
"%~dp0.venv\Scripts\python.exe" -m catalog ask %*
