@echo off
chcp 65001 >nul
title ScreenSnap - Liberar atalho Win+Shift+S no Windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0toggle-win-shift-s.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
if "%~1"=="" (
  echo.
  pause
)
exit /b %EXIT_CODE%
