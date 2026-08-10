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

# 3. Start polling after the web server becomes healthy unless staging
# explicitly disables external side effects.
if [ "$DISABLE_STARTUP_SERVICES" = "true" ]; then
  echo "[Startup] DISABLE_STARTUP_SERVICES=true; skipping auto startup services"
else
  (
    echo "[Startup] Waiting for DSH to be ready..."
    sleep 10
    for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
      HEALTH=$(curl -s http://127.0.0.1:3000/api/health 2>/dev/null)
      if echo "$HEALTH" | grep -q '"status":"ok"'; then
        echo "[Startup] DSH is ready, starting polling..."
        curl -s -X POST http://127.0.0.1:3000/api/startup
        echo "[Startup] Polling started!"
        exit 0
      fi
      echo "[Startup] Not ready yet, retrying in 5s..."
      sleep 5
    done
    echo "[Startup] WARNING: Could not start polling after 70s"
  ) &
fi

# 4. Discord public text ingress. This is the replacement for Kite's Gateway
# listener/fanout and also owns the bot presence shown in Discord.
if [ "$DISABLE_STARTUP_SERVICES" = "true" ]; then
  echo "[Startup] Startup services disabled; skipping Discord ingress bot"
elif [ -n "$DISCORD_BOT_TOKEN" ]; then
  (
    echo "[Startup] Waiting to start Discord ingress bot..."
    sleep 20
    DSH_DISCORD_INGRESS_URL="http://127.0.0.1:3000" \
      DSH_DISCORD_PRESENCE="${DSH_DISCORD_PRESENCE:-Powered by Space Mountain}" \
      npm run discord-ingress-bot
  ) &
else
  echo "[Startup] Discord ingress bot disabled because DISCORD_BOT_TOKEN is not set"
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

# 6. Focused Twitch repair-command watcher. It observes only !mtfixit and leaves
# the existing points and conversational Athena listeners unchanged.
if [ "$DISABLE_STARTUP_SERVICES" = "true" ]; then
  echo "[Startup] Startup services disabled; skipping Twitch mtfixit watcher"
elif [ -n "${SPMT_API_KEY:-${SPMT_PLATFORM_API_KEY:-}}" ]; then
  (
    echo "[Startup] Waiting to start Twitch mtfixit watcher..."
    sleep 30
    npm run watch-mtfixit-twitch
  ) &
else
  echo "[Startup] Twitch mtfixit watcher disabled because SPMT_API_KEY is not set"
fi

# 7. Make the Next server the container's PID 1. This ensures Fly observes the
# real web process, receives its exit status, and can reach 0.0.0.0:3000.
export PORT=3000
export HOSTNAME=0.0.0.0
echo "[Startup] Starting DSH on 0.0.0.0:3000"
exec ./node_modules/.bin/next start -H 0.0.0.0 -p 3000
