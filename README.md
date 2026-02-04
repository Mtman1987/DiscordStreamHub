# 🚀 Discord Stream Hub

Automated Discord bot that monitors Twitch streams and posts live shoutouts for your community members. Features intelligent group routing, GIF rotation for VIPs, and community spotlight.

## 🌐 Live App

**URL:** https://discord-stream-hub.fly.dev

## ✨ Features

- **10-Minute Polling**: Automatically checks Twitch every 10 minutes
- **Smart Updates**: Posts new streams, updates existing shoutouts, removes offline streams
- **Group Routing**: Different channels and templates for each group
  - **Crew**: Custom template with GIF rotation
  - **Partners**: Custom template with GIF rotation  
  - **Honored Guests**: Special template
  - **Raid Pile**: Raid-focused template
  - **Everyone Else**: Standard template
- **Community Spotlight**: Rotates through live community members every 10 minutes with their own GIF
- **Rate Limited**: Respects Twitch (1.2s) and Discord (0.6s) API limits
- **Spam Prevention**: 1-hour cooldown per user
- **Fresh Data**: Updates viewer count, title, and game every 10 minutes

## 🎮 How It Works

### Automatic Monitoring
1. Bot checks all 220+ linked Twitch accounts every 10 minutes
2. When someone goes live, posts a shoutout to their group's Discord channel
3. Updates the shoutout every 10 minutes with fresh stream data
4. Removes the shoutout when they go offline
5. Rotates community spotlight between "Honored Guests" and "Everyone Else" members

### Data Freshness
- **New streams**: Posted within 10 minutes of going live
- **Updates**: Viewer count, title, game refreshed every 10 minutes
- **Offline**: Removed within 10 minutes of going offline
- **Maximum staleness**: 10 minutes

## 📱 Using the App

### For Admins

#### 1. Access the Dashboard
- Go to https://discord-stream-hub.fly.dev
- Sign in with Discord (admin account required)

#### 2. Configure Channels
- Navigate to `/settings`
- Click "Sync with Discord" to load your server's channels
- Assign Discord channels for each group:
  - Crew Channel
  - Partners Channel
  - Honored Guests Channel
  - Raid Pile Channel
  - Community Channel (Everyone Else)
- Save configuration

#### 3. Link Twitch Accounts
- Members link their Twitch accounts via the web interface
- Bot automatically detects their group based on Discord roles
- Linked accounts are monitored every 10 minutes

#### 4. Monitor Status
- Check `/api/health` to see if polling is active
- View logs in Fly.io dashboard
- Shoutouts appear automatically in Discord

### For Community Members

#### Link Your Twitch Account
1. Go to https://discord-stream-hub.fly.dev
2. Sign in with Discord
3. Click "Link Twitch Account"
4. Authorize the connection
5. Your streams will now be monitored!

#### What to Expect
- When you go live, a shoutout appears in your group's channel within 10 minutes
- The shoutout updates every 10 minutes with current viewer count
- When you go offline, the shoutout is removed within 10 minutes
- **Crew/Partners**: Your shoutout includes an animated GIF from your clips
- **Honored Guests/Everyone Else**: You may be featured in the community spotlight with your own GIF

## 🔧 Admin Commands

### Check Bot Health
```bash
curl https://discord-stream-hub.fly.dev/api/health
```

Returns:
```json
{
  "status": "ok",
  "polling": {
    "active": true,
    "serverId": "1240832965865635881"
  }
}
```

### Start/Restart Polling
```bash
curl -X POST https://discord-stream-hub.fly.dev/api/startup
```

**Note:** After each deployment, you must restart polling using this command.

### View Logs
```bash
fly logs -a discord-stream-hub
```

## 📊 Shoutout Templates

### Crew Members
- Cyan color theme (#00D9FF)
- Animated GIF from their clips
- "Space Mountain Crew Member" badge
- Custom description highlighting their role

### Partners
- Purple color theme (#8B00FF)
- Animated GIF from their clips
- "Official Space Mountain Partner" badge
- Partner-focused description

### Honored Guests
- Orange color theme (#FF8C00)
- Profile picture thumbnail
- "Honored Guest" designation
- Eligible for community spotlight

### Raid Pile
- Teal color theme (#4ECDC4)
- Profile picture thumbnail
- "Raid Pile Shoutout" footer
- Raid-focused messaging

### Everyone Else (Mountaineers)
- Purple color theme (#9146FF)
- Profile picture thumbnail
- "Mountaineer Shoutout" footer
- Eligible for community spotlight

## 🌟 Community Spotlight

Every 10 minutes, one live member from "Honored Guests" or "Everyone Else" gets featured:
- Their shoutout includes an animated GIF from their clips
- Footer changes to "⭐ COMMUNITY SPOTLIGHT ⭐"
- Rotates to the next person after 10 minutes
- Gives everyone their "10 minutes of fame"

## ⚙️ Technical Details

### Polling Behavior
- **Interval**: Exactly 10 minutes (600,000ms)
- **Rate Limiting**: 
  - Twitch API: 1.2s delay between calls (50/min, limit 800/min)
  - Discord API: 0.6s delay between operations (100/min, limit 5000/min)
- **Cooldown**: 1 hour between shoutouts for the same user
- **Capacity**: Monitors 220+ users per server

### Architecture
- **Platform**: Fly.io (always-on)
- **Framework**: Next.js 16
- **Database**: Firebase Firestore
- **Storage**: Firebase Storage (for GIFs)
- **APIs**: Twitch Helix API, Discord API

### Health Checks
- Fly.io monitors `/api/health` every 15 seconds
- App automatically restarts if unhealthy
- Graceful shutdown handlers preserve polling state

## 🚨 Troubleshooting

### Polling Not Active
1. Check health: `curl https://discord-stream-hub.fly.dev/api/health`
2. If `"active": false`, restart: `curl -X POST https://discord-stream-hub.fly.dev/api/startup`
3. Verify in Firestore: `servers/{GUILD_ID}/twitchPollingActive` should be `true`

### Shoutouts Not Posting
- Verify channels are configured in `/settings`
- Check that user's Twitch account is linked
- Ensure user has correct Discord role for their group
- Check logs for errors: `fly logs -a discord-stream-hub`

### Wrong Channel
- Go to `/settings`
- Update channel assignments
- Save changes
- Next poll cycle will use new channels

### Stale Data
- Bot updates every 10 minutes automatically
- Maximum staleness is 10 minutes
- If data seems old, check logs for polling errors

## 📞 Support

- **Logs**: `fly logs -a discord-stream-hub`
- **Status**: https://discord-stream-hub.fly.dev/api/health
- **Dashboard**: https://fly.io/apps/discord-stream-hub

## 🎉 Success Indicators

Your bot is working correctly when:
- ✅ Health check shows `"active": true`
- ✅ Logs show "Starting poll cycle" every 10 minutes
- ✅ New live streams get shoutouts within 10 minutes
- ✅ Shoutouts update every 10 minutes with fresh data
- ✅ Offline streams are removed within 10 minutes
- ✅ No rate limit errors in logs
- ✅ Community spotlight rotates every 10 minutes (when 2+ eligible members are live)

---

**Bot Status**: 🟢 Live and Monitoring
**Polling Interval**: Every 10 minutes
**Monitored Users**: 220+
**Uptime**: 24/7 on Fly.io
