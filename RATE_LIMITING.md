# Rate Limiting & Data Freshness

## Polling Behavior

### Timing
- **Interval**: Exactly 10 minutes (600,000ms)
- **Consistency**: Uses `setInterval` - runs every 10 minutes, no more, no less
- **Initial Poll**: Runs immediately on startup, then every 10 minutes

### What Happens Every 10 Minutes

1. **Fetch All Stream Statuses** (Batch)
   - Queries Twitch API for all linked users
   - 1.2 second delay between each user check
   - Respects Twitch rate limit: 50 requests/minute

2. **Update Live Streams**
   - Posts new shoutouts for users who just went live
   - Updates existing shoutouts with fresh data (viewer count, title, etc.)
   - 0.6 second delay between Discord operations
   - Respects Discord rate limit: 100 requests/minute

3. **Remove Offline Streams**
   - Deletes shoutouts for users who went offline
   - Prevents stale data from showing
   - Rate limited: 0.6s between deletions

4. **Rotate Community Spotlight**
   - Updates community spotlight channel
   - Shows random active community member

## Rate Limiting

### Twitch API
- **Limit**: 800 requests per minute (per client ID)
- **Our Rate**: 50 requests per minute (1.2s delay)
- **Safety Margin**: 93.75% under limit
- **Batch Optimization**: Checks up to 100 users per request when possible

### Discord API
- **Limit**: 50 requests per second globally
- **Per Channel**: 5 requests per second
- **Our Rate**: ~100 requests per minute (0.6s delay)
- **Safety Margin**: Well under all limits

### Example Timeline (50 users)
```
00:00 - Poll starts
00:01 - Twitch API: Check user 1
00:02 - Twitch API: Check user 2 (1.2s delay)
...
01:00 - All 50 users checked
01:01 - Discord: Post shoutout 1
01:02 - Discord: Post shoutout 2 (0.6s delay)
...
01:30 - All shoutouts posted/updated
01:30 - Poll complete
10:00 - Next poll starts
```

## Data Freshness Guarantees

### Live Status
- ✅ **Maximum Staleness**: 10 minutes
- ✅ **Updates**: Every poll cycle
- ✅ **Accuracy**: Real-time from Twitch API

### Shoutout Posts
- ✅ **New Streams**: Posted within 10 minutes of going live
- ✅ **Updates**: Viewer count, title, game updated every 10 minutes
- ✅ **Offline**: Removed within 10 minutes of going offline

### Cooldown Protection
- ✅ **Duplicate Prevention**: 1 hour cooldown per user
- ✅ **Prevents Spam**: Won't repost if user goes offline/online quickly

## Why 10 Minutes?

1. **Fresh Data**: 10 minutes is acceptable for stream notifications
2. **Rate Limit Safety**: Plenty of time to process all users
3. **API Costs**: Reduces unnecessary API calls
4. **Discord Spam**: Prevents channel flooding
5. **Server Load**: Manageable resource usage

## Scaling Considerations

### Current Capacity (10 min interval)
- **Max Users**: ~400 users per server
- **Twitch Calls**: 400 calls per 10 min = 40/min (under 50/min limit)
- **Discord Calls**: ~50 calls per 10 min = 5/min (under 100/min limit)

### If You Need More
- Add multiple bot tokens (separate rate limits)
- Implement queue system for large servers
- Use webhooks instead of bot messages (higher limits)

## Monitoring

### Check Rate Limiting
```bash
# View logs for rate limit warnings
fly logs | grep -i "rate"

# Check poll timing
fly logs | grep "Poll cycle completed"
```

### Verify 10-Minute Intervals
```bash
# Should see logs every 10 minutes
fly logs | grep "Starting poll cycle"
```

### Expected Log Pattern
```
[TwitchPolling] Starting poll cycle for server 123...
[TwitchPolling] Checking 50 linked users
[TwitchPolling] Found 5 live streams
[TwitchPolling] Posted Crew shoutout for user1
[TwitchPolling] Updated shoutout for user2
[TwitchPolling] Deleted shoutout for user3 (went offline)
[TwitchPolling] Poll cycle completed for server 123
... 10 minutes later ...
[TwitchPolling] Starting poll cycle for server 123...
```

## Best Practices

1. ✅ **Don't manually trigger polls** - Let the 10-minute cycle run
2. ✅ **Monitor logs** - Watch for rate limit warnings
3. ✅ **Limit linked users** - Keep under 400 per server
4. ✅ **Use cooldowns** - 1 hour prevents spam
5. ✅ **Trust the system** - 10 minutes is optimal
