FROM node:20-slim

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
