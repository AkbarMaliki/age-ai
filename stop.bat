@echo off
rem Stops whatever is serving Abad Kerajaan on port 8772.
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 8772 -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; Write-Host 'Server Abad Kerajaan dihentikan.' } else { Write-Host 'Tidak ada server yang berjalan di port 8772.' }"
timeout /t 3 >nul
