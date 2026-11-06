@echo off
setlocal EnableExtensions
title Local Domain Launcher - amigo-enterprises.com

REM ============================================================
REM Configuration - change these values if your setup differs.
REM ============================================================
set "DOMAIN=amigo-enterprises.com"
set "APP_HOST=127.0.0.1"
set "APP_PORT=3000"
set "NGINX_DIR=C:\nginx"
set "HOSTS_FILE=%SystemRoot%\System32\drivers\etc\hosts"
set "NGINX_CONF=%NGINX_DIR%\conf\nginx.conf"

REM Request Administrator privileges if not already elevated.
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Requesting Administrator privileges...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo ================================================
echo  Local domain setup: http://%DOMAIN%
echo ================================================
echo.

REM Check Nginx installation.
if not exist "%NGINX_DIR%\nginx.exe" (
    echo ERROR: Nginx was not found at "%NGINX_DIR%\nginx.exe"
    echo Install/extract Nginx to C:\nginx or edit NGINX_DIR in this BAT file.
    pause
    exit /b 1
)

REM Check that the local application is listening on port 3000.
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-NetConnection -ComputerName '%APP_HOST%' -Port %APP_PORT% -InformationLevel Quiet) { exit 0 } else { exit 1 }"
if errorlevel 1 (
    echo ERROR: Nothing appears to be listening on %APP_HOST%:%APP_PORT%.
    echo Start your project first, then run this BAT file again.
    pause
    exit /b 1
)

REM Add domain mapping to Windows hosts file only if it is not already present.
findstr /I /R /C:"^[ ]*127\.0\.0\.1[ ]%DOMAIN%\([ ]\|$\)" "%HOSTS_FILE%" >nul 2>&1
if errorlevel 1 (
    echo Adding %DOMAIN% to the Windows hosts file...
    >>"%HOSTS_FILE%" echo.
    >>"%HOSTS_FILE%" echo 127.0.0.1    %DOMAIN%
) else (
    echo Hosts entry already exists.
)

REM Back up the current Nginx config once before replacing it.
if not exist "%NGINX_CONF%.before-amigo.bak" (
    copy "%NGINX_CONF%" "%NGINX_CONF%.before-amigo.bak" >nul
    if errorlevel 1 (
        echo ERROR: Could not back up "%NGINX_CONF%".
        pause
        exit /b 1
    )
)

REM Write a minimal Nginx config for this local application.
(
    echo worker_processes  1;
    echo events { worker_connections 1024; }
    echo http {
    echo     include       mime.types;
    echo     default_type  application/octet-stream;
    echo     sendfile      on;
    echo     server {
    echo         listen 80;
    echo         server_name %DOMAIN%;
    echo         location / {
    echo             proxy_pass http://%APP_HOST%:%APP_PORT%;
    echo             proxy_http_version 1.1;
    echo             proxy_set_header Host $host;
    echo             proxy_set_header X-Real-IP $remote_addr;
    echo             proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    echo             proxy_set_header X-Forwarded-Proto $scheme;
    echo             proxy_set_header Upgrade $http_upgrade;
    echo             proxy_set_header Connection "upgrade";
    echo         }
    echo     }
    echo }
) > "%NGINX_CONF%"

if errorlevel 1 (
    echo ERROR: Could not write the Nginx configuration.
    pause
    exit /b 1
)

REM Validate configuration before starting/reloading Nginx.
pushd "%NGINX_DIR%"
nginx.exe -t
if errorlevel 1 (
    echo ERROR: Nginx configuration test failed.
    echo Your previous config backup is: "%NGINX_CONF%.before-amigo.bak"
    popd
    pause
    exit /b 1
)

REM Start Nginx if not running; otherwise reload its config.
tasklist /FI "IMAGENAME eq nginx.exe" 2>nul | find /I "nginx.exe" >nul
if errorlevel 1 (
    echo Starting Nginx...
    start "" /B "%NGINX_DIR%\nginx.exe"
) else (
    echo Reloading Nginx...
    nginx.exe -s reload
    if errorlevel 1 (
        echo WARNING: Reload failed. Trying to start Nginx...
        start "" /B "%NGINX_DIR%\nginx.exe"
    )
)
popd

REM Flush DNS cache and open the local domain.
ipconfig /flushdns >nul 2>&1
timeout /t 2 /nobreak >nul
start "" "http://%DOMAIN%"

echo.
echo Done. Your local URL is: http://%DOMAIN%
echo Keep your project running on port %APP_PORT%.
echo This setup is local to this Windows computer only.
echo.
pause
endlocal
