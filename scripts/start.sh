#!/bin/sh

# 1. Seed database from export (skips if data exists)
node scripts/seed-local-db.js

# 2. Clean shoutout channels (fresh slate on every deploy)
node scripts/clean-channels.js

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

# 5. Keep container alive with the DSH process
wait $DSH_PID
