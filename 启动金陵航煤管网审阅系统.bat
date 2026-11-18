@echo off
setlocal
title Jinling IDF Review System Launcher

set "APP_DIR=%~dp0idf-web-viewer"
set "APP_URL=http://127.0.0.1:8082/?v=14"

if not exist "%APP_DIR%\index.html" goto missing_files

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 8082 -State Listen -ErrorAction SilentlyContinue; if (-not $listener) { $python = (Get-Command python -ErrorAction SilentlyContinue).Source; if (-not $python) { exit 2 }; Start-Process -WindowStyle Hidden -FilePath $python -WorkingDirectory '%~dp0' -ArgumentList @('-m','http.server','8082','--bind','127.0.0.1','--directory','%APP_DIR%') }; $ready = $false; for ($i = 0; $i -lt 15; $i++) { try { $response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8082/' -TimeoutSec 1; if ($response.StatusCode -eq 200) { $ready = $true; break } } catch {}; Start-Sleep -Seconds 1 }; if (-not $ready) { exit 3 }; Start-Process 'http://127.0.0.1:8082/?v=14'; exit 0"

if errorlevel 3 goto server_timeout
if errorlevel 2 goto python_missing
if errorlevel 1 goto launch_failed
exit /b 0

:missing_files
echo System files were not found in: %APP_DIR%
echo Keep this launcher in the IDF project root folder.
pause
exit /b 1

:python_missing
echo Python was not found. Install Python or add it to PATH.
pause
exit /b 2

:server_timeout
echo Local server startup timed out. Check whether port 8082 is available.
pause
exit /b 3

:launch_failed
echo The local review system could not be started.
pause
exit /b 4
