@echo off
setlocal EnableDelayedExpansion
title Abad Kerajaan - build ^& deploy
cd /d "%~dp0"

rem ===== settings =====================================================
rem  REPO    = GitHub repository used for GitHub Pages (Settings > Pages >
rem            Deploy from a branch > main / docs). Game URL becomes
rem            https://<user>.github.io/<repo>/
rem  SITE / PROJECT = only for the optional Firebase Hosting deploy (option 3)
set REPO=https://github.com/AkbarMaliki/abad-kerajaan.git
set SITE=abad-kerajaan-game
set PROJECT=vuez-63625
set FB=npx -y firebase-tools@13
rem ====================================================================

echo.
echo  [1/2] Membangun versi web ke folder "docs" (+ abad-kerajaan-web.zip)...
echo.
python tools\build.py
if errorlevel 1 (
  echo.
  echo  Build GAGAL. Pastikan Python + Pillow terpasang:  pip install pillow
  pause
  exit /b 1
)

echo.
echo  Build selesai. Pilih langkah berikutnya:
echo    1 = Selesai saja (folder "docs" siap; push sendiri ke GitHub)
echo    2 = Commit ^& push ke GitHub  (GitHub Pages dari main / docs)
echo    3 = Deploy ke Firebase Hosting  -^>  https://%SITE%.web.app
echo.
choice /c 123 /n /m "  Pilihan [1/2/3]: "
if errorlevel 3 goto firebase
if errorlevel 2 goto github
goto done

:github
where git >nul 2>&1 || (echo  Git belum terpasang: https://git-scm.com/download/win & goto done)
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Folder ini belum repo git. Buat dulu repo KOSONG di GitHub, misalnya:
  echo     %REPO%
  echo  ^(tanpa README / .gitignore / license, supaya push pertama tidak bentrok^)
  echo.
  set /p URL="  URL repo GitHub [Enter = %REPO%]: "
  if "!URL!"=="" set URL=%REPO%
  git init -b main
  git remote add origin !URL!
)
echo.
git add -A .
git commit -m "Build web %date% %time%"
git push -u origin main
if errorlevel 1 (
  echo.
  echo  Push GAGAL. Cek pesan di atas ^(login GitHub, URL repo, atau repo belum kosong^).
  pause
  exit /b 1
)
echo.
echo  Terkirim! Kalau ini push pertama, aktifkan sekali saja di GitHub:
echo    Repo ^> Settings ^> Pages ^> Build and deployment ^> Source: "Deploy from a branch"
echo    Branch: main   Folder: /docs   ^> Save
echo  Setelah 1-2 menit game bisa dibuka di https://^<username^>.github.io/^<nama-repo^>/
goto done

:firebase
echo.
echo  Deploy ke Firebase (project %PROJECT%, site %SITE%)...
echo  (pertama kali akan diminta login Google di browser)
call %FB% login:list | findstr /i /c:"Logged in as" >nul
if errorlevel 1 call %FB% login
call %FB% hosting:sites:create %SITE% --project %PROJECT% >nul 2>&1
call %FB% deploy --only hosting --project %PROJECT%
if errorlevel 1 (
  echo.
  echo  Deploy GAGAL. Kalau nama site sudah dipakai, ganti SITE di atas build.bat.
  pause
  exit /b 1
)
echo  SELESAI! Game online di:  https://%SITE%.web.app
start "" https://%SITE%.web.app

:done
echo.
pause
