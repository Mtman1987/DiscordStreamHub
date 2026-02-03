# Space Mountain Shoutout System - Implementation Plan

## Overview
Automated Discord shoutout system with dynamic clip GIF rotation for Crew and Partners. Polls Twitch every 10 minutes, manages shoutout lifecycle, and rotates through cached clip GIFs.

---

## 1. CLIP GIF ROTATION SYSTEM

### 1.1 Daily Clip Fetching (Runs once per day at 3 AM)
**Service**: `clip-fetching-service.ts`

**Process**:
1. Query Firestore for all Crew + Partners members
2. For each member:
   - Fetch 1 new clip from Twitch API (last 24 hours, most viewed)
   - Download clip MP4 from Twitch CDN
   - Convert to GIF using FFmpeg (max 10 seconds, 480p, optimized)
   - Upload GIF to Firebase Storage: `clips/{twitchLogin}/{timestamp}.gif`
   - Store metadata in Firestore: `servers/{serverId}/users/{userId}/clips/[clipId]`
   - Maintain max 10 clips per user (delete oldest if > 10)

**Firestore Clip Schema**:
```typescript
{
  clipId: string,
  gifUrl: string, // Firebase Storage URL
  createdAt: Timestamp,
  twitchClipId: string,
  title: string,
  viewCount: number,
  duration: number
}
```

**FFmpeg Command**:
```bash
ffmpeg -i input.mp4 -vf "fps=15,scale=480:-1:flags=lanczos" -c:v gif output.gif
```

### 1.2 Clip Rotation During Streams
**Service**: `clip-rotation-service.ts`

**Process**:
- When Crew/Partner goes live, load their cached clips from Firestore
- Every 10 minutes during their stream:
  - Select next clip in rotation (round-robin)
  - Update Discord message with new clip GIF
  - Track current clip index in Firestore

**Rotation Logic**:
```typescript
currentClipIndex = (currentClipIndex + 1) % totalClips
```

---

## 2. AUTOMATIC SHOUTOUT SYSTEM

### 2.1 Twitch Polling Service (Every 10 minutes)
**Service**: `twitch-polling-service.ts` (ALREADY EXISTS)

**Process**:
1. Fetch all linked Twitch users from Firestore
2. Batch check Twitch API for live status (100 users per request)
3. Compare with previous state stored in Firestore
4. Trigger appropriate action:
   - **New Live** → Post shoutout
   - **Still Live** → Update shoutout (clip rotation for Crew/Partners)
   - **Went Offline** → Delete shoutout

### 2.2 Shoutout State Management
**Firestore Schema**: `servers/{serverId}/users/{userId}/shoutoutState`
```typescript
{
  isLive: boolean,
  messageId: string | null, // Discord message ID
  channelId: string,
  lastUpdated: Timestamp,
  currentClipIndex: number, // For Crew/Partners
  streamStartedAt: Timestamp
}
```

### 2.3 Group-Specific Channels
**Firestore Schema**: `servers/{serverId}/channels`
```typescript
{
  crewChannelId: string,
  partnersChannelId: string,
  communityChannelId: string, // Honored Guests + Mountaineer share this
  raidPileChannelId: string
}
```

### 2.4 Shoutout Posting Logic
**Service**: `shoutout-posting-service.ts`

**For Each Group**:

#### Crew (Cyan, Buttons, Clip GIFs, Dividers)
- Fetch cached clips from Firestore
- Select clip based on rotation index
- Generate embed with clip GIF as image
- Post to crew channel
- If multiple crew live, insert divider banners between shoutouts
- Store Discord messageId in Firestore

#### Partners (Purple, Buttons, Clip GIFs)
- Same as Crew but no dividers
- Post to partners channel

#### Honored Guests (Orange, Animated Emote)
- Static stream preview image
- Post to community channel

#### Mountaineer/Everyone Else (Purple, Basic)
- Static stream preview image
- Post to community channel

#### Raid Pile (Teal, Basic)
- Static stream preview image
- Post to raid pile channel

### 2.5 Shoutout Update Logic (Every 10 minutes)
**Process**:
1. Check if user still live
2. If Crew/Partners:
   - Rotate to next clip
   - Edit Discord message with new clip GIF
   - Update currentClipIndex in Firestore
3. If other groups:
   - Update viewer count, game, title
   - Edit Discord message

**Discord API**:
```typescript
PATCH /channels/{channelId}/messages/{messageId}
Body: { embeds: [updatedEmbed] }
```

### 2.6 Shoutout Deletion Logic
**Process**:
1. Detect user went offline
2. Delete Discord message using messageId
3. Clear shoutoutState in Firestore

**Discord API**:
```typescript
DELETE /channels/{channelId}/messages/{messageId}
```

---

## 3. IMPLEMENTATION SERVICES

### 3.1 Core Services to Create/Update

1. **clip-fetching-service.ts** (NEW)
   - Daily clip fetching
   - FFmpeg conversion
   - Firebase Storage upload
   - Firestore metadata storage

2. **clip-rotation-service.ts** (NEW)
   - Load cached clips
   - Rotation logic
   - Clip selection

3. **shoutout-posting-service.ts** (NEW)
   - Generate embeds for all groups
   - Post to Discord
   - Handle Crew dividers
   - Store messageId

4. **shoutout-update-service.ts** (NEW)
   - Update existing shoutouts
   - Clip rotation for Crew/Partners
   - Edit Discord messages

5. **twitch-polling-service.ts** (UPDATE EXISTING)
   - Add state comparison logic
   - Trigger post/update/delete actions
   - Handle all 5 groups

6. **shoutout-service.ts** (UPDATE EXISTING)
   - Integrate new templates
   - Add clip GIF support
   - Remove old VIP logic

### 3.2 Cloud Scheduler Jobs

1. **Twitch Polling** (Every 10 minutes)
   - Endpoint: `/api/polling/twitch`
   - Checks live status
   - Manages shoutout lifecycle

2. **Daily Clip Fetching** (3 AM daily)
   - Endpoint: `/api/clips/fetch-daily`
   - Fetches new clips
   - Converts to GIFs
   - Stores in Firebase

3. **Clip Rotation** (Every 10 minutes, offset by 5 min from polling)
   - Endpoint: `/api/clips/rotate`
   - Updates Crew/Partner shoutouts with new clips

---

## 4. FIREBASE STORAGE STRUCTURE

```
clips/
  {twitchLogin}/
    {timestamp}_clip1.gif
    {timestamp}_clip2.gif
    ...
    {timestamp}_clip10.gif
banners/
  crew_divider.gif
```

---

## 5. RATE LIMITING & OPTIMIZATION

### Twitch API Limits
- 800 requests/minute
- Batch users: 100 per request
- For 346 users: 4 requests = well under limit

### Discord API Limits
- 50 requests/second
- Edit message: No special limit
- Batch operations with 100ms delay between requests

### FFmpeg Optimization
- Max 10 seconds per clip
- 480p resolution
- 15 fps
- Optimized palette for smaller file size
- Target: < 5MB per GIF

---

## 6. ERROR HANDLING

### Clip Fetching Failures
- Log error
- Skip user for this cycle
- Retry next day

### Discord API Failures
- Retry 3 times with exponential backoff
- Log failure
- Continue with next user

### FFmpeg Failures
- Log error
- Fall back to static image
- Retry next day

---

## 7. TESTING STRATEGY

### Phase 1: Templates (CURRENT)
- Test all 5 group templates manually
- Verify Discord formatting
- Test buttons and links

### Phase 2: Clip System
- Test clip fetching for 1 user
- Test FFmpeg conversion
- Test Firebase Storage upload
- Test clip rotation

### Phase 3: Polling Integration
- Test with 5 test users
- Verify post/update/delete logic
- Test state management

### Phase 4: Full Deployment
- Enable for all users
- Monitor logs
- Adjust timing if needed

---

## 8. CONFIGURATION

### Environment Variables
```env
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
DISCORD_BOT_TOKEN=...
FIREBASE_STORAGE_BUCKET=...
CREW_BANNER_GIF_URL=...
CLIP_FETCH_SCHEDULE=0 3 * * * # 3 AM daily
POLLING_SCHEDULE=*/10 * * * * # Every 10 minutes
```

### Firestore Indexes
- `servers/{serverId}/users` - Compound: `group`, `twitchLogin`
- `servers/{serverId}/users/{userId}/clips` - Order by: `createdAt DESC`

---

## 9. NEXT STEPS

1. ✅ Complete all templates (DONE)
2. Create clip-fetching-service.ts
3. Integrate FFmpeg
4. Test clip conversion pipeline
5. Create clip-rotation-service.ts
6. Update twitch-polling-service.ts
7. Create shoutout-posting-service.ts
8. Create shoutout-update-service.ts
9. Test with small group
10. Deploy to production

---

## 10. ESTIMATED COSTS

### Firebase Storage
- 10 clips × 5MB × 50 Crew/Partners = 2.5GB
- Cost: ~$0.06/month

### Cloud Functions
- Polling: 4,320 invocations/month (every 10 min)
- Clip fetching: 50 invocations/month (daily)
- Cost: Free tier covers this

### Twitch API
- Free

### FFmpeg Processing
- Cloud Functions 2nd gen with 2GB RAM
- ~10 seconds per clip
- Cost: ~$0.10/month

**Total: ~$0.20/month**

---

## NOTES
- Crew dividers only appear when multiple crew members are live simultaneously
- Honored Guests and Mountaineer share the same channel but have different templates
- Clip rotation only applies to Crew and Partners
- All other groups use static Twitch stream preview images
- System handles 300+ shoutouts/day easily with current architecture
