FROM node:22-slim
ARG GITHUB_SHA=unknown
ARG GH_SHA=$GITHUB_SHA
LABEL GITHUB_SHA=$GITHUB_SHA
LABEL GH_SHA=$GH_SHA

# Cache bust: v0.4.1 — chromium for image generation
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    python3 \
    build-essential \
    curl \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund

COPY . .

# NEXT_PUBLIC_ vars must be available at build time for Next.js client bundle
# Pass via: fly deploy --build-arg NEXT_PUBLIC_TWITCH_CLIENT_ID=xxx ...
# Or set in fly.toml [build.args]
ARG NEXT_PUBLIC_TWITCH_CLIENT_ID
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_DISCORD_CLIENT_ID
ARG NEXT_PUBLIC_HARDCODED_GUILD_ID
ARG NEXT_PUBLIC_HARDCODED_ADMIN_DISCORD_ID
ARG NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID

RUN NEXT_PUBLIC_TWITCH_CLIENT_ID=$NEXT_PUBLIC_TWITCH_CLIENT_ID \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_DISCORD_CLIENT_ID=$NEXT_PUBLIC_DISCORD_CLIENT_ID \
    NEXT_PUBLIC_HARDCODED_GUILD_ID=$NEXT_PUBLIC_HARDCODED_GUILD_ID \
    NEXT_PUBLIC_HARDCODED_ADMIN_DISCORD_ID=$NEXT_PUBLIC_HARDCODED_ADMIN_DISCORD_ID \
    NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID=$NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID \
    DSH_BUILD_DB=1 \
    npm run build

EXPOSE 3000 3001

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV DB_FILE=/data/app.db
ENV STORAGE_PATH=/data/clips
ENV MUSIC_CACHE_DIR=/data/music

# Seed DB, start app, auto-start polling
COPY scripts/start.sh /app/scripts/start.sh
RUN chmod +x /app/scripts/start.sh
CMD ["/bin/sh", "/app/scripts/start.sh"]
