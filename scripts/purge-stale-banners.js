#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const BANNER_VERSION = '2026-08-28-role-aware-1';
const dataDir = process.env.DATA_DIR || process.env.FLY_VOLUME_PATH || '/data';
const storagePath = process.env.STORAGE_PATH || path.join(dataDir, 'clips');
const bannersDir = path.join(storagePath, 'banners');
const markerPath = path.join(bannersDir, `.purged-${BANNER_VERSION}`);

if (!fs.existsSync(bannersDir)) {
  fs.mkdirSync(bannersDir, { recursive: true });
}

if (fs.existsSync(markerPath)) {
  console.log(`[BannerMigration] ${BANNER_VERSION} purge already completed`);
  process.exit(0);
}

let removed = 0;
for (const fileName of fs.readdirSync(bannersDir)) {
  if (!fileName.endsWith('.gif') && !fileName.endsWith('.gif.meta.json')) continue;
  fs.unlinkSync(path.join(bannersDir, fileName));
  removed += 1;
}

fs.writeFileSync(markerPath, `${new Date().toISOString()}\n`, 'utf8');
console.log(`[BannerMigration] Removed ${removed} stale banner files; ${BANNER_VERSION} will regenerate on demand`);
