@echo off
echo ========================================
echo Pre-Deployment Checklist
echo ========================================
echo.

REM Check if Fly CLI is installed
echo [1/5] Checking Fly CLI installation...
fly version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Fly CLI not installed!
    echo Please install: iwr https://fly.io/install.ps1 -useb ^| iex
    pause
    exit /b 1
)
echo [OK] Fly CLI installed
echo.

REM Check if logged in
echo [2/5] Checking Fly.io authentication...
fly auth whoami >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Not logged in to Fly.io
    echo Please run: fly auth login
    pause
    exit /b 1
)
echo [OK] Logged in to Fly.io
echo.

REM Check Firebase service account
echo [3/5] Checking Firebase service account...
if not exist "studio-9468926194-e03ac-firebase-adminsdk-fbsvc-28f637ffb4.json" (
    echo [ERROR] Firebase service account file not found!
    echo Expected: studio-9468926194-e03ac-firebase-adminsdk-fbsvc-28f637ffb4.json
    pause
    exit /b 1
)
echo [OK] Firebase service account found
echo.

REM Check .env file
echo [4/5] Checking environment variables...
if not exist ".env" (
    echo [WARNING] .env file not found
    echo This is OK if secrets are already set in Fly.io
) else (
    echo [OK] .env file found
)
echo.

REM Test build locally
echo [5/5] Testing build...
echo This may take a few minutes...
call npm run build >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Build failed! Fix errors before deploying.
    echo Run: npm run build
    pause
    exit /b 1
)
echo [OK] Build successful
echo.

echo ========================================
echo All checks passed! Ready to deploy.
echo ========================================
echo.
echo Next steps:
echo 1. Run: deploy-to-fly.bat
echo 2. Or manually: fly deploy
echo.
pause
