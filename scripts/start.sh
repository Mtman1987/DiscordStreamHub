#!/bin/sh

# 1. Seed database from export (skips if data exists)
if [ -f scripts/seed-local-db.js ]; then
  node scripts/seed-local-db.js
else
  echo "[Startup] No seed-local-db.js found; skipping seed"
fi

# 2. Do not clean Discord channels on normal deploys. This deletes live bot
# messages and shoutout state, so keep it as an explicit emergency action only.
if [ "$RUN_DEPLOY_CLEANUP" = "true" ]; then
  if [ -f scripts/clean-channels.js ]; then
    node scripts/clean-channels.js
  else
    echo "[Startup] RUN_DEPLOY_CLEANUP=true but clean-channels.js is missing; skipping cleanup"
  fi
else
  echo "[Startup] Skipping deploy channel cleanup"
fi

# 3. Start DSH (port 3000) in background
# Pin the port explicitly so Fly always sees the server on the configured
# internal port, even if the runtime environment injects a different PORT.
PORT=3000 npm run start -- -p 3000 -H 0.0.0.0 &
DSH_PID=$!

# 4. Wait for DSH to be ready, then start polling unless staging explicitly
# disables external side effects.
if [ "$DISABLE_STARTUP_SERVICES" = "true" ]; then
  echo "[Startup] DISABLE_STARTUP_SERVICES=true; skipping auto startup services"
else
  (
    echo "[Startup] Waiting for DSH to be ready..."
    sleep 20
    for i in 1 2 3 4 5 6; do
      HEALTH=$(curl -s http://localhost:3000/api/health 2>/dev/null)
      if echo "$HEALTH" | grep -q '"status":"ok"'; then
        echo "[Startup] DSH is ready, starting polling..."
        curl -s -X POST http://localhost:3000/api/startup
        echo "[Startup] Polling started!"
        exit 0
      fi
      echo "[Startup] Not ready yet, retrying in 10s..."
      sleep 10
    done
    echo "[Startup] WARNING: Could not start polling after 80s"
  ) &
fi

# 5. Optional Discord voice adapter. Its public enable flag and endpoints live
# in the volume-backed runtime config; the bot token remains a Fly secret.
RUNTIME_CONFIG_FILE="${RUNTIME_CONFIG_FILE:-/data/runtime-config.json}"
WATCH_VOICE_ENABLED="$(node -e "try{const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(c.publicFlags?.discordWatchVoiceBot===false?'false':'true')}catch{process.stdout.write('true')}" "$RUNTIME_CONFIG_FILE")"
WATCH_VOICE_BASE_URL="$(node -e "try{const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(c.publicUrls?.hearmeoutUrl||'https://hearmeout-main.fly.dev')}catch{process.stdout.write('https://hearmeout-main.fly.dev')}" "$RUNTIME_CONFIG_FILE")"
WATCH_VOICE_LIVEKIT_URL="$(node -e "try{const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(c.publicUrls?.livekitUrl||'wss://streamweaver-7atx04ct.livekit.cloud')}catch{process.stdout.write('wss://streamweaver-7atx04ct.livekit.cloud')}" "$RUNTIME_CONFIG_FILE")"
WATCH_VOICE_BRIDGE_ROOM="$(node -e "try{const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(c.publicText?.discordVoiceBridgeRoomId||'discord-activity')}catch{process.stdout.write('discord-activity')}" "$RUNTIME_CONFIG_FILE")"
if [ "$WATCH_VOICE_ENABLED" = "true" ] && [ -n "$DISCORD_BOT_TOKEN" ]; then
  (
    echo "[Startup] Waiting to start Discord voice adapter..."
    sleep 25
    WATCHROOM_DSH_BASE_URL="$WATCH_VOICE_BASE_URL" \
      WATCHROOM_LIVEKIT_URL="$WATCH_VOICE_LIVEKIT_URL" \
      WATCHROOM_BRIDGE_ROOM_ID="$WATCH_VOICE_BRIDGE_ROOM" \
      npm run watch-voice-bot
  ) &
elif [ "$WATCH_VOICE_ENABLED" = "true" ]; then
  echo "[Startup] Discord voice adapter enabled but DISCORD_BOT_TOKEN is not set"
else
  echo "[Startup] Discord voice adapter disabled by volume runtime config"
fi

# 6. Keep container alive with the DSH process
wait $DSH_PID
