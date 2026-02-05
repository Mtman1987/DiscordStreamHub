@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Discord Stream Hub - Fly.io Deployment
echo ========================================
echo.

REM Step 1: Check if app exists
echo [Step 1] Checking if app exists...
fly status -a discord-stream-hub >nul 2>&1
if %errorlevel% neq 0 (
    echo App does not exist. Creating new app...
    fly launch --name discord-stream-hub --region iad --no-deploy
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create app
        pause
        exit /b 1
    )
    echo [OK] App created
) else (
    echo [OK] App already exists
)
echo.

REM Step 2: Set Firebase service account as secret
echo [Step 2] Setting Firebase service account secret...
echo This is a large secret, may take a moment...

REM Read the service account file and set as secret
for /f "delims=" %%i in ('type studio-9468926194-e03ac-firebase-adminsdk-fbsvc-28f637ffb4.json') do set SERVICE_ACCOUNT=%%i
fly secrets set FIREBASE_SERVICE_ACCOUNT="%SERVICE_ACCOUNT%" -a discord-stream-hub
if %errorlevel% neq 0 (
    echo [ERROR] Failed to set Firebase secret
    pause
    exit /b 1
)
echo [OK] Firebase secret set
echo.

REM Step 3: Set all other secrets from .env file
echo [Step 3] Setting environment secrets from .env file...
echo NOTE: Make sure .env file exists with all required secrets
echo.

REM Load secrets from .env and set them
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if not "%%b"=="" (
        fly secrets set %%a="%%b" -a discord-stream-hub
    )
)

if %errorlevel% neq 0 (
    echo [ERROR] Failed to set secrets
    pause
    exit /b 1
)
echo [OK] All secrets set
echo.

REM Step 4: Deploy
echo [Step 4] Deploying to Fly.io...
echo This will take several minutes...
fly deploy -a discord-stream-hub
if %errorlevel% neq 0 (
    echo [ERROR] Deployment failed
    pause
    exit /b 1
)
echo [OK] Deployment successful
echo.

REM Step 5: Get app URL
echo [Step 5] Getting app URL...
for /f "tokens=*" %%i in ('fly status -a discord-stream-hub ^| findstr "Hostname"') do set HOSTNAME_LINE=%%i
for /f "tokens=2" %%i in ("%HOSTNAME_LINE%") do set APP_URL=%%i
echo App URL: https://%APP_URL%
echo.

REM Step 6: Wait for app to be ready
echo [Step 6] Waiting for app to be ready...
timeout /t 10 /nobreak >nul
echo.

REM Step 7: Initialize polling
echo [Step 7] Initializing polling service...
curl -X POST https://%APP_URL%/api/startup
echo.
echo.

REM Step 8: Check health
echo [Step 8] Checking health...
curl https://%APP_URL%/api/health
echo.
echo.

echo ========================================
echo Deployment Complete!
echo ========================================
echo.
echo App URL: https://%APP_URL%
echo.
echo Next steps:
echo 1. Enable polling in Firestore:
echo    - Go to Firebase Console
echo    - Set: servers/1240832965865635881/twitchPollingActive = true
echo.
echo 2. Monitor logs:
echo    fly logs -a discord-stream-hub
echo.
echo 3. Check health:
echo    curl https://%APP_URL%/api/health
echo.
pause
