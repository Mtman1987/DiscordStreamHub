# 🚀 Quick Reference Card

## Deploy to Fly.io
```bash
fly deploy
```

## Initialize Polling
```bash
# Windows
init-production.bat

# Linux/Mac
./init-production.sh

# Manual
curl -X POST https://discord-stream-hub.fly.dev/api/startup
```

## Check Health
```bash
curl https://discord-stream-hub.fly.dev/api/health
```

## View Logs
```bash
fly logs
fly logs -a discord-stream-hub
```

## Restart App
```bash
fly apps restart discord-stream-hub
```

## Update Secrets
```bash
fly secrets set KEY="value"
fly secrets list
```

## Enable/Disable Polling
**Firestore**: `servers/{GUILD_ID}/twitchPollingActive`
- `true` = Polling enabled
- `false` = Polling disabled

## Key Endpoints
- `/api/startup` - Initialize services (POST)
- `/api/health` - Health check (GET)
- `/settings` - Configure channels (Web UI)

## Polling Behavior
- **Interval**: Exactly 10 minutes (no more, no less)
- **Cooldown**: 1 hour per user
- **Auto-start**: Reads Firestore flag
- **Rate Limiting**:
  - Twitch: 1.2s delay (50/min, limit 800/min)
  - Discord: 0.6s delay (100/min, limit 5000/min)
- **Data Freshness**:
  - New streams: Posted within 10 min
  - Updates: Every 10 min (viewer count, title)
  - Offline: Removed within 10 min
  - Max staleness: 10 minutes

## Troubleshooting
```bash
# Not polling?
1. Check Firestore flag
2. Call /api/startup
3. Check logs

# Wrong channels?
1. Go to /settings
2. Configure group channels
3. Save changes

# App crashed?
fly status
fly logs
fly apps restart discord-stream-hub
```

## Important Files
- `fly.toml` - Fly.io config
- `Dockerfile` - Container config
- `DEPLOYMENT.md` - Full deployment guide
- `PROJECT_STATUS.md` - Current status
