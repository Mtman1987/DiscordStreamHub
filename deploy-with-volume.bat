@echo off
echo Creating Fly.io volume...
fly volumes create discord_stream_data --size 10 --region iad --yes

echo.
echo Deploying to Fly.io...
fly deploy

echo.
echo Restarting polling...
timeout /t 5 /nobreak >nul
curl -X POST https://discord-stream-hub.fly.dev/api/startup

echo.
echo Done! Check status:
echo https://discord-stream-hub.fly.dev/api/health
