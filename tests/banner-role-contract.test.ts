import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BANNER_VERSION,
  isStoredBannerCurrent,
  resolveBannerVariant,
} from '../src/lib/banner-policy.ts';

const root = process.cwd();
const worker = fs.readFileSync(path.join(root, 'clip-worker/worker.js'), 'utf8');
const template = fs.readFileSync(path.join(root, 'public/banner-template.html'), 'utf8');
const requestService = fs.readFileSync(path.join(root, 'src/lib/live-banner-request-service.ts'), 'utf8');
const manualService = fs.readFileSync(path.join(root, 'src/lib/manual-discord-shoutout-service.ts'), 'utf8');
const uploadRoute = fs.readFileSync(path.join(root, 'src/app/api/clips/upload/route.ts'), 'utf8');

test('only the owner resolves to commander; crew and mountaineers stay separate', () => {
  assert.equal(resolveBannerVariant({ twitchLogin: 'mtman1987' }), 'commander');
  assert.equal(resolveBannerVariant({ twitchLogin: 'spacemountainlive' }), 'commander');
  assert.equal(resolveBannerVariant({
    twitchLogin: 'spacemountainlive',
    discordUserId: 'owner-discord',
    adminDiscordUserId: 'owner-discord',
    group: 'Crew',
  }), 'commander');
  assert.equal(resolveBannerVariant({
    twitchLogin: 'crew_member',
    group: 'Crew',
  }), 'crew');
  assert.equal(resolveBannerVariant({
    twitchLogin: 'unlinked_viewer',
  }), 'mountaineer');
  assert.equal(resolveBannerVariant({
    twitchLogin: 'signal_user',
    group: 'Everyone Else',
  }), 'mountaineer');
  assert.equal(resolveBannerVariant({
    twitchLogin: 'partner_user',
    group: 'Partners',
  }), 'mountaineer');
});

test('stored banners are current only when both role and generator version match', () => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-banner-meta-'));
  const bannersDir = path.join(storagePath, 'banners');
  fs.mkdirSync(bannersDir, { recursive: true });
  fs.writeFileSync(path.join(bannersDir, 'viewer.gif'), 'gif');
  fs.writeFileSync(path.join(bannersDir, 'viewer.gif.meta.json'), JSON.stringify({
    version: BANNER_VERSION,
    variant: 'mountaineer',
  }));

  assert.equal(isStoredBannerCurrent(storagePath, 'viewer', 'mountaineer'), true);
  assert.equal(isStoredBannerCurrent(storagePath, 'viewer', 'crew'), false);

  fs.writeFileSync(path.join(bannersDir, 'viewer.gif.meta.json'), JSON.stringify({
    version: 'old-version',
    variant: 'mountaineer',
  }));
  assert.equal(isStoredBannerCurrent(storagePath, 'viewer', 'mountaineer'), false);
  fs.rmSync(storagePath, { recursive: true, force: true });
});

test('the shared template is crisp, lightweight, and mathematically seamless', () => {
  assert.match(template, /animation: banner-scroll 20s linear infinite/);
  assert.match(template, /translate3d\(-50%, 0, 0\)/);
  assert.equal((template.match(/class="message"/g) || []).length, 2);
  assert.match(template, /MOUNTAINEER|\{\{LABEL_HTML\}\}/);
  assert.doesNotMatch(template, /🌟|🚀|👑/u);
  assert.equal(fs.existsSync(path.join(root, 'public/banner-crew.html')), false);
  assert.equal(fs.existsSync(path.join(root, 'public/banner-commander.html')), false);
});

test('the worker captures fixed animation times instead of compressing wall-clock recording', () => {
  assert.match(worker, /const BANNER_WIDTH = 960/);
  assert.match(worker, /const BANNER_HEIGHT = 100/);
  assert.match(worker, /const BANNER_FPS = 10/);
  assert.match(worker, /const BANNER_DURATION_SECONDS = 20/);
  assert.match(worker, /animation\.currentTime = currentTimeMs/);
  assert.doesNotMatch(worker, /setTimeout\(resolve, 1000 \/ fps\)/);
  assert.match(worker, /palettegen=max_colors=96:stats_mode=diff/);
  assert.match(worker, /paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle/);
  assert.match(worker, /bannerRequests/);
  assert.match(worker, /bannerVariant/);
});

test('unlinked Twitch users default to Mountaineer and uploads require current role metadata', () => {
  assert.match(requestService, /bannerRequests: \[\{ username: normalizedLogin, variant \}\]/);
  assert.match(requestService, /return resolveBannerVariant/);
  assert.match(requestService, /result\?\.bannerVersion !== BANNER_VERSION/);
  assert.match(requestService, /generatedCount/);
  assert.match(manualService, /getExpectedLiveBannerVariant/);
  assert.doesNotMatch(manualService, /!entry\.needsBanner\) return/);
  assert.match(uploadRoute, /stale banner generator version/);
  assert.match(uploadRoute, /\['commander', 'crew', 'mountaineer'\]/);
});

test('the volume migration purges legacy banners once and preserves regenerated files', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-banner-purge-'));
  const storagePath = path.join(dataDir, 'clips');
  const bannersDir = path.join(storagePath, 'banners');
  fs.mkdirSync(bannersDir, { recursive: true });
  fs.writeFileSync(path.join(bannersDir, 'legacy.gif'), 'gif');
  fs.writeFileSync(path.join(bannersDir, 'legacy.gif.meta.json'), '{}');

  const env = { ...process.env, DATA_DIR: dataDir, STORAGE_PATH: storagePath };
  execFileSync(process.execPath, ['scripts/purge-stale-banners.js'], { cwd: root, env });
  assert.equal(fs.existsSync(path.join(bannersDir, 'legacy.gif')), false);
  assert.equal(fs.existsSync(path.join(bannersDir, `.purged-${BANNER_VERSION}`)), true);

  fs.writeFileSync(path.join(bannersDir, 'regenerated.gif'), 'gif');
  execFileSync(process.execPath, ['scripts/purge-stale-banners.js'], { cwd: root, env });
  assert.equal(fs.existsSync(path.join(bannersDir, 'regenerated.gif')), true);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
