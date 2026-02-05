# 🚀 Discord Stream Hub

Automated Discord bot that monitors Twitch streams and posts live shoutouts for your community members. Features intelligent group routing, GIF rotation for VIPs, community spotlight, points system, and leaderboards.

## 🌐 Live App

**URL:** https://discord-stream-hub.fly.dev

## ✨ Features

- **10-Minute Polling**: Automatically checks Twitch every 10 minutes
- **Smart Updates**: Posts new streams, updates existing shoutouts, removes offline streams
- **Fully Customizable**: Set your own server name, branding, and shoutout templates
- **Group Routing**: Different channels and templates for each group
  - **Crew**: Custom template with GIF rotation
  - **Partners**: Custom template with GIF rotation  
  - **Honored Guests**: Special template
  - **Raid Pile**: Raid-focused template
  - **Everyone Else**: Standard template
- **Community Spotlight**: Rotates through live community members every 10 minutes with their own GIF
- **Points & Leaderboards**: Award points for Twitch chat activity, calendar events, and admin actions
- **Calendar System**: Schedule and manage community events
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

## 🚀 Quick Start Guide

### Prerequisites
1. **Discord Bot**: Create a bot at [Discord Developer Portal](https://discord.com/developers/applications)
   - Enable "Server Members Intent" and "Message Content Intent"
   - Invite bot to your server with permissions: Send Messages, Embed Links, Manage Messages
2. **Twitch App**: Create an app at [Twitch Developer Console](https://dev.twitch.tv/console)
3. **Firebase Project**: Set up Firestore and Storage at [Firebase Console](https://console.firebase.google.com)

### Setup Steps

#### 1. Initial Configuration
1. Deploy the app to Fly.io or your hosting platform
2. Set environment variables:
   ```bash
   DISCORD_CLIENT_ID=your_discord_client_id
   DISCORD_CLIENT_SECRET=your_discord_client_secret
   DISCORD_BOT_TOKEN=your_bot_token
   TWITCH_CLIENT_ID=your_twitch_client_id
   TWITCH_CLIENT_SECRET=your_twitch_client_secret
   HARDCODED_GUILD_ID=your_discord_server_id
   HARDCODED_ADMIN_DISCORD_ID=your_discord_user_id
   ```

#### 2. Access Settings Page
1. Go to `https://your-app-url.com`
2. Sign in with Discord (must be the admin user)
3. Navigate to `/settings`

#### 3. Configure Your Server (Follow the numbered steps on settings page)

**Step 1: Server Identity**
- Set your server name (e.g., "My Gaming Community")
- Set community member names (e.g., "Member" / "Members")
- Default: "Space Mountain" / "Mountaineer" / "Mountaineers"

**Step 2: Twitch Integration**
- Link your personal Twitch account (for admin features)
- Link a bot Twitch account (for chat monitoring and points)

**Step 3: Customize Shoutouts**
- Edit templates for Crew, Partners, and Community shoutouts
- Use `{username}` placeholder for dynamic usernames
- Preview templates in a Discord channel before saving

**Step 4: Member Management**
- Click "Process Members" to scan your Discord server
- Click "Auto-Link Accounts" to match Discord users with Twitch
- View linked/unlinked member counts

**Step 5: Start Monitoring**
- Click "Sync with Discord" to load channels
- Assign channels for each group (Crew, Partners, Community, etc.)
- Map Discord roles to groups
- Click "Start Polling" to begin monitoring streams

#### 4. Verify Setup
```bash
curl https://your-app-url.com/api/health
```
Should return: `{"status": "ok", "polling": {"active": true}}`

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
1. Go to your app URL
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
- **Points**: Earn points for chat activity, which appear on the leaderboard

## 🎨 Customization

### Server Branding
All text throughout the app uses your configured server name and member names:
- Shoutout messages
- Raid pile announcements
- Community spotlight
- Leaderboard displays
- AI-generated content

### Shoutout Templates
Customize three template types:
1. **Crew Template**: For VIP/staff members
   - Title, description, badge text, footer
2. **Partners Template**: For official partners
   - Title, description, badge text, footer
3. **Community Template**: For regular members
   - Title, footer

All templates support `{username}` placeholder.

### Preview Before Saving
- Select a Discord channel from dropdown
- Click "Preview" button for any template
- See exactly how it will look in Discord
- Make adjustments and preview again

## 🌟 Community Spotlight

Every 10 minutes, one live member from "Honored Guests" or "Everyone Else" gets featured:
- Their shoutout includes an animated GIF from their clips
- Footer changes to "⭐ COMMUNITY SPOTLIGHT ⭐"
- Rotates to the next person after 10 minutes
- Gives everyone their "10 minutes of fame"

## 🔧 Admin Commands & API Endpoints

### Check Bot Health
```bash
curl https://your-app-url.com/api/health
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
curl -X POST https://your-app-url.com/api/startup
```

**Note:** After each deployment, you must restart polling using this command.

### View Logs
```bash
fly logs -a discord-stream-hub
```

## 📊 Default Templates (Space Mountain)

The app comes pre-configured with Space Mountain branding as defaults:

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

## 🏆 Points & Leaderboards

### How Points Work
- **Twitch Chat**: Earn points for messages, subs, gifted subs, bits, and raids
- **Calendar Events**: Admins award points for event participation
- **Admin Actions**: Separate leaderboard for admin contributions

### Leaderboard Features
- View top performers in real-time
- Post top 10 to Discord with "Check My Rank" button
- Separate admin leaderboard for staff contributions
- Only tracks users in your community list (not all Discord/Twitch users)

## 📅 Calendar System

- Schedule community events
- Events auto-hide after they end
- Award points to participants
- Integrated with Discord announcements

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
1. Check health: `curl https://your-app-url.com/api/health`
2. If `"active": false`, restart: `curl -X POST https://your-app-url.com/api/startup`
3. Verify in Firestore: `servers/{GUILD_ID}/twitchPollingActive` should be `true`

### Shoutouts Not Posting
- Verify channels are configured in `/settings` Step 5
- Check that user's Twitch account is linked
- Ensure user has correct Discord role for their group
- Check logs for errors

### Branding Not Updating
- Save branding in `/settings` Step 1
- Restart polling to apply changes
- Check Firestore: `servers/{GUILD_ID}/config/branding`

### Templates Not Applying
- Save templates in `/settings` Step 3
- Templates apply immediately to new shoutouts
- Existing shoutouts update on next poll cycle (10 min)

### Wrong Channel
- Go to `/settings`
- Update channel assignments
- Save changes
- Next poll cycle will use new channels

### Stale Data
- Bot updates every 10 minutes automatically
- Maximum staleness is 10 minutes
- If data seems old, check logs for polling errors

## 📞 Support & Resources

- **Health Check**: `https://your-app-url.com/api/health`
- **Settings Page**: `https://your-app-url.com/settings`
- **Documentation**: This README
- **Discord Developer Portal**: https://discord.com/developers/applications
- **Twitch Developer Console**: https://dev.twitch.tv/console

## 🎉 Success Indicators

Your bot is working correctly when:
- ✅ Health check shows `"active": true`
- ✅ Logs show "Starting poll cycle" every 10 minutes
- ✅ New live streams get shoutouts within 10 minutes
- ✅ Shoutouts update every 10 minutes with fresh data
- ✅ Offline streams are removed within 10 minutes
- ✅ No rate limit errors in logs
- ✅ Community spotlight rotates every 10 minutes (when 2+ eligible members are live)
- ✅ Your custom branding appears in all messages
- ✅ Points are being awarded and leaderboard updates

## 🌍 Multi-Server Support

This app supports multiple Discord servers:
- Each server has its own branding, templates, and settings
- Data is isolated per server in Firestore
- Admin must set `HARDCODED_GUILD_ID` and `HARDCODED_ADMIN_DISCORD_ID` for their server
- Space Mountain defaults are used until custom branding is configured

---

**Default Branding**: Space Mountain (fully customizable)
**Polling Interval**: Every 10 minutes
**Supported Users**: Unlimited per server
**Uptime**: 24/7 (recommended: Fly.io or similar)
