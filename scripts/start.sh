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
npx next start -H 0.0.0.0 &
DSH_PID=$!

# 4. Wait for DSH to be ready, then start polling
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

# 5. Optional legacy Discord watch command bot.
# External bots can send the same command payloads to /api/discord/chat, so keep
# this disabled unless a deploy explicitly opts into the in-container bot.
if [ "$ENABLE_WATCH_VOICE_BOT" = "true" ] && [ -n "$DISCORD_BOT_TOKEN" ]; then
  (
    echo "[Startup] Waiting to start watch command bot..."
    sleep 25
    WATCHROOM_DSH_BASE_URL="${WATCHROOM_DSH_BASE_URL:-http://localhost:3000}" npm run watch-voice-bot
  ) &
elif [ "$ENABLE_WATCH_VOICE_BOT" = "true" ]; then
  echo "[Startup] ENABLE_WATCH_VOICE_BOT=true but DISCORD_BOT_TOKEN is not set; watch command bot disabled"
else
  echo "[Startup] Legacy watch command bot disabled; expecting external bot to POST /api/discord/chat"
fi

# 6. Keep container alive with the DSH process
wait $DSH_PID
