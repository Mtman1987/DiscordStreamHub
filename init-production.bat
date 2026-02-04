@echo off
REM Production Startup Script for Windows
REM This script initializes the polling service after deployment

SET APP_URL=%1
IF "%APP_URL%"=="" SET APP_URL=https://discord-stream-hub.fly.dev

echo.
echo 🚀 Initializing Discord Stream Hub...
echo 📍 Target: %APP_URL%
echo.

REM Check health first
echo 🏥 Checking health endpoint...
curl -s "%APP_URL%/api/health"
echo.
echo.

REM Initialize services
echo ⚡ Starting polling services...
curl -s -X POST "%APP_URL%/api/startup"
echo.
echo.

REM Wait and verify
echo ✅ Verifying polling status...
timeout /t 2 /nobreak >nul
curl -s "%APP_URL%/api/health"
echo.
echo.

echo ✅ Initialization complete! Check the output above to verify polling is active.
pause
