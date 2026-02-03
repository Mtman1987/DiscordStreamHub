@echo off
echo Firebase Secrets Upload Tool
echo ============================
echo.

REM Check if Node.js is available
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)

REM Check if Firebase CLI is available
firebase --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Firebase CLI not found. Installing...
    npm install -g firebase-tools
    if %errorlevel% neq 0 (
        echo Failed to install Firebase CLI. Please install manually:
        echo npm install -g firebase-tools
        pause
        exit /b 1
    )
)

echo Checking Firebase authentication...
firebase projects:list >nul 2>&1
if %errorlevel% neq 0 (
    echo You need to login to Firebase first.
    echo Opening Firebase login...
    firebase login
    if %errorlevel% neq 0 (
        echo Login failed. Please try again.
        pause
        exit /b 1
    )
)

echo.
echo Starting secrets upload...
echo.

node upload-secrets-advanced.js

echo.
echo Press any key to exit...
pause >nul