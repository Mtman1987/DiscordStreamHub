# 📊 Polling Cycle Visualization

## Timeline View (10 Minute Cycle)

```
┌─────────────────────────────────────────────────────────────────┐
│                    POLL CYCLE (Every 10 Minutes)                │
└─────────────────────────────────────────────────────────────────┘

00:00 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      │
      ├─► Fetch linked users from Firestore
      │
      ├─► Check Twitch API for each user
      │   ├─ User 1: GET /streams?user_login=user1
      │   ├─ ⏱️  Wait 1.2 seconds (rate limit)
      │   ├─ User 2: GET /streams?user_login=user2
      │   ├─ ⏱️  Wait 1.2 seconds (rate limit)
      │   ├─ User 3: GET /streams?user_login=user3
      │   └─ ... continue for all users
      │
      ├─► Process Results
      │   │
      │   ├─ User 1: NEWLY LIVE
      │   │  └─► POST Discord message (shoutout)
      │   │      ⏱️  Wait 0.6 seconds (rate limit)
      │   │
      │   ├─ User 2: STILL LIVE
      │   │  └─► PATCH Discord message (update viewer count)
      │   │      ⏱️  Wait 0.6 seconds (rate limit)
      │   │
      │   ├─ User 3: WENT OFFLINE
      │   │  └─► DELETE Discord message (remove shoutout)
      │   │      ⏱️  Wait 0.6 seconds (rate limit)
      │   │
      │   └─ User 4: STILL OFFLINE
      │      └─► No action needed
      │
      ├─► Rotate community spotlight
      │
      └─► Log completion

10:00 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      │
      └─► REPEAT CYCLE
```

## State Transitions

```
┌──────────────┐
│ User Offline │
└──────┬───────┘
       │
       │ Goes Live
       ▼
┌──────────────────────────────┐
│ Twitch API: Stream detected  │
└──────┬───────────────────────┘
       │
       │ Check cooldown (1 hour)
       ▼
┌──────────────────────────────┐
│ POST Discord Shoutout        │ ◄─── NEW SHOUTOUT
│ Save messageId to Firestore  │
└──────┬───────────────────────┘
       │
       │ Still Live (next poll)
       ▼
┌──────────────────────────────┐
│ PATCH Discord Message        │ ◄─── UPDATE (Fresh Data)
│ Update viewer count, title   │
└──────┬───────────────────────┘
       │
       │ Still Live (next poll)
       ▼
┌──────────────────────────────┐
│ PATCH Discord Message        │ ◄─── UPDATE (Fresh Data)
│ Update viewer count, title   │
└──────┬───────────────────────┘
       │
       │ Goes Offline
       ▼
┌──────────────────────────────┐
│ DELETE Discord Message       │ ◄─── REMOVE (No Stale Data)
│ Clear Firestore state        │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────┐
│ User Offline │
└──────────────┘
```

## Rate Limiting Visualization

```
TWITCH API CALLS (1.2 second spacing)
═══════════════════════════════════════════════════════════════

User 1  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        │                                                      │
        ├─► API Call                                          │
        │   ⏱️  1.2s                                           │
        │                                                      │
User 2  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                │                                              │
                ├─► API Call                                  │
                │   ⏱️  1.2s                                   │
                │                                              │
User 3  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                        │                                      │
                        ├─► API Call                          │
                        │   ⏱️  1.2s                           │
                        │                                      │

Result: 50 calls/minute (Limit: 800/minute) ✅ SAFE


DISCORD API CALLS (0.6 second spacing)
═══════════════════════════════════════════════════════════════

Post 1  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        │                                                      │
        ├─► POST Message                                      │
        │   ⏱️  0.6s                                           │
        │                                                      │
Update 1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                │                                              │
                ├─► PATCH Message                             │
                │   ⏱️  0.6s                                   │
                │                                              │
Delete 1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                        │                                      │
                        ├─► DELETE Message                    │
                        │   ⏱️  0.6s                           │
                        │                                      │

Result: 100 calls/minute (Limit: 5000/minute) ✅ SAFE
```

## Data Freshness Timeline

```
Stream Goes Live
│
├─ 00:00 ─ User starts streaming
│
├─ 00:05 ─ (waiting for next poll)
│
├─ 10:00 ─ Poll detects stream ✅
│          Shoutout posted
│
├─ 20:00 ─ Poll updates shoutout ✅
│          Fresh viewer count
│
├─ 30:00 ─ Poll updates shoutout ✅
│          Fresh title/game
│
├─ 35:00 ─ User stops streaming
│
├─ 40:00 ─ Poll detects offline ✅
│          Shoutout deleted
│
└─ Result: Maximum staleness = 10 minutes
```

## Cooldown Protection

```
User Goes Live
│
├─ 10:00 ─ Shoutout posted ✅
│          Cooldown starts (1 hour)
│
├─ 10:30 ─ User goes offline
│          Shoutout deleted
│
├─ 10:45 ─ User goes live again
│          ❌ Cooldown active (15 min elapsed)
│          No shoutout posted
│
├─ 11:00 ─ Still live
│          ❌ Cooldown active (60 min not elapsed)
│          No shoutout posted
│
├─ 11:01 ─ Cooldown expires ✅
│          Next time live = new shoutout
│
└─ Result: Prevents spam from on/off cycling
```

## Capacity Planning

```
Users per Server: 50
Poll Interval: 10 minutes
═══════════════════════════════════════════════════════════════

Twitch API Calls:
  50 users × 1 call each = 50 calls per cycle
  50 calls ÷ 10 minutes = 5 calls/minute
  Limit: 800 calls/minute
  Usage: 0.6% ✅ EXCELLENT

Discord API Calls (worst case - all live):
  50 users × 1 operation each = 50 operations per cycle
  50 operations ÷ 10 minutes = 5 operations/minute
  Limit: 5000 operations/minute
  Usage: 0.1% ✅ EXCELLENT

═══════════════════════════════════════════════════════════════
Maximum Capacity: ~400 users per server before hitting limits
```

## Summary

✅ **Timing**: Exactly 10 minutes, guaranteed by setInterval
✅ **Fresh Data**: Updates every cycle, max 10 min staleness
✅ **New Streams**: Posted within 10 minutes of going live
✅ **Offline Streams**: Removed within 10 minutes
✅ **Rate Limited**: 1.2s (Twitch), 0.6s (Discord)
✅ **Safe Margins**: 93% under Twitch limit, 98% under Discord limit
✅ **No Spam**: 1 hour cooldown prevents duplicate posts
✅ **Scalable**: Handles up to 400 users per server
