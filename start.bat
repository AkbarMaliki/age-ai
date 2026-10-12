@echo off
title Abad Kerajaan - server (tutup jendela ini untuk menghentikan)
cd /d "%~dp0"
rem Server already running? Then just open the game.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8772 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo Server sudah berjalan di http://localhost:8772 - membuka browser...
  start "" http://localhost:8772
  timeout /t 3 >nul
  exit /b
)
echo Menjalankan server Abad Kerajaan di http://localhost:8772
echo Tutup jendela ini (atau tekan Ctrl+C) untuk menghentikan server.
echo.
start "" http://localhost:8772
node server.cjs 8772
echo.
echo Server berhenti.
pause
