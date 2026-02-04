# 🚀 Cosmic Raid - Discord Stream Hub

A Discord bot that monitors Twitch streams and posts automated shoutouts when community members go live. Features intelligent group routing, GIF rotation, and rate-limited polling.

## ✨ Features

- **10-Minute Polling**: Checks Twitch every 10 minutes (exactly)
- **Smart Updates**: Posts new streams, updates existing, removes offline
- **Rate Limited**: Respects Twitch (1.2s) and Discord (0.6s) API limits
- **Group Routing**: Different channels for Crew, Partners, Honored Guests, etc.
- **GIF Rotation**: Animated clips for Crew and Partners
- **Spam Prevention**: 1-hour cooldown per user
- **No Stale Data**: Removes offline streams within 10 minutes

## 🚀 Quick Start

### Development
1.  **Install Dependencies:** `npm install`
2.  **Configure Environment:** Copy `.env.example` to `.env` and fill in values
3.  **Run the App:** `npm run dev`
4.  **Initial Data Sync:** Go to `/settings` and click "Sync with Discord"

### Production (Fly.io)
1.  **Deploy:** See `DEPLOYMENT_CHECKLIST.md`
2.  **Initialize:** Run `init-production.bat`
3.  **Monitor:** `fly logs`

## 📚 Documentation

- **DEPLOYMENT_CHECKLIST.md** - Step-by-step deployment guide
- **READY_TO_DEPLOY.md** - Summary of all changes and guarantees
- **RATE_LIMITING.md** - Rate limiting details and best practices
- **POLLING_DIAGRAM.md** - Visual diagrams of polling cycle
- **PROJECT_STATUS.md** - What was fixed and why
- **QUICK_REFERENCE.md** - Common commands

## ⚙️ How It Works

### Every 10 Minutes:
1. Fetch all linked users from Firestore
2. Check Twitch API for each user (1.2s delay between calls)
3. Post shoutouts for newly live streams (0.6s delay)
4. Update existing shoutouts with fresh data (0.6s delay)
5. Delete shoutouts for offline streams (0.6s delay)
6. Rotate community spotlight

### Data Freshness:
- **New streams**: Posted within 10 minutes
- **Updates**: Viewer count, title, game refreshed every 10 minutes
- **Offline**: Removed within 10 minutes
- **Max staleness**: 10 minutes

### Rate Limiting:
- **Twitch**: 50 calls/min (limit: 800/min) - 93% safety margin
- **Discord**: 100 calls/min (limit: 5000/min) - 98% safety margin

## 🛡️ Guarantees

✅ Polls every 10 minutes - **EXACTLY**  
✅ Updates existing shoutouts - **NO STALE DATA**  
✅ Posts new streams - **WITHIN 10 MIN**  
✅ Removes offline streams - **WITHIN 10 MIN**  
✅ Rate limited API calls - **NO FAILURES**  
✅ Spam prevention - **1 HOUR COOLDOWN**
