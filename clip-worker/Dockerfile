FROM node:20-slim

ARG GITHUB_SHA=unknown
ARG GH_SHA=unknown
ARG BUILD_SHA=unknown
LABEL GITHUB_SHA=$GITHUB_SHA
LABEL GH_SHA=$GH_SHA
LABEL BUILD_SHA=$BUILD_SHA

RUN apt-get update && apt-get install -y \
    ffmpeg \
    chromium \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Only need puppeteer for live recording fallback
RUN npm install puppeteer-core

COPY worker.js .

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 8080

CMD ["node", "worker.js"]
