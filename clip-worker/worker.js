#!/usr/bin/env node

/**
 * Clip Worker — runs as a separate Fly app.
 *
 * Loop:
 *   1. Ask DSH which streamers need clips  (GET /api/clips/needed)
 *   2. For each streamer, fetch Twitch clips via GraphQL
 *   3. Download MP4, convert to GIF at full quality (480px, 12fps)
 *   4. Push finished GIF to DSH                    (POST /api/clips/upload)
 *   5. Sleep, repeat
 *
 * If GraphQL fails, falls back to Puppeteer live-stream recording.
 * Runs one conversion at a time so it never OOMs.
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const fsSync = require('fs');
const { existsSync, mkdirSync } = fsSync;
const os = require('os');
const path = require('path');
const http = require('http');

const execAsync = promisify(exec);

function getDataDir() {
  return process.env.DATA_DIR || process.env.FLY_VOLUME_PATH || path.join(process.cwd(), 'data');
}

function readRuntimeConfig() {
  try {
    const runtimeConfigPath = path.join(getDataDir(), 'runtime-config.json');
    if (!existsSync(runtimeConfigPath)) return {};
    return JSON.parse(fsSync.readFileSync(runtimeConfigPath, 'utf8'));
  } catch {
    return {};
  }
}

function getRuntimeValue(section, key, fallback = '') {
  const config = readRuntimeConfig();
  return (config?.[section]?.[key] || fallback || '').toString();
}

// ── Config ──
const DSH_URL = getRuntimeValue('publicUrls', 'baseUrl', process.env.DSH_URL || 'https://discord-stream-hub-new.fly.dev');
const WORKER_SECRET = String(process.env.CLIP_WORKER_SECRET || '').trim();
const SERVER_ID = getRuntimeValue('publicIds', 'hardcodedGuildId', process.env.HARDCODED_GUILD_ID || '1240832965865635881');
const TWITCH_CLIENT_ID = getRuntimeValue('publicIds', 'twitchClientId', process.env.TWITCH_CLIENT_ID || 'rxmohc28tthq0nudfd6iwx0sgy88dp');
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
const POLL_INTERVAL = 10 * 60 * 1000; // 10 minutes between cycles
const GIFS_PER_STREAMER = 2;
const HEALTH_PORT = process.env.PORT || 8080;
const DEFAULT_CREW_MEMBERS = [
  'Akhiteddy',
  'differentdecree',
  'swordsmanEB',
  'brotherdavid09',
  'MotherMiranda',
  'UDHero2K',
  'Scarletkitty1313',
];
const BANNER_VERSION = '2026-08-28-role-aware-1';
const BANNER_WIDTH = 960;
const BANNER_HEIGHT = 100;
const BANNER_FPS = 10;
const BANNER_DURATION_SECONDS = 20;
const NEBULA_CAPTURE_WIDTH = 800;
const NEBULA_CAPTURE_HEIGHT = 450;
const NEBULA_CAPTURE_FPS = 10;
const BANNER_VARIANTS = {
  commander: {
    labelHtml: 'COMMANDER MT',
    messageHtml: 'THE MOUNTAIN IS LIVE &bull; ALL SYSTEMS GO',
    primaryColor: '#ffd24a',
    secondaryColor: '#fff0a6',
    showUsername: false,
  },
  crew: {
    labelHtml: 'SPACEMOUNTAIN CREW',
    messageHtml: 'CREW SIGNAL LOCKED &bull; LIVE NOW',
    primaryColor: '#00b7ff',
    secondaryColor: '#79dcff',
    showUsername: true,
  },
  mountaineer: {
    labelHtml: 'MOUNTAINEER <span class="heart">&hearts;</span>',
    messageHtml: 'SIGNAL RECEIVED &bull; LIVE NOW',
    primaryColor: '#39e58c',
    secondaryColor: '#a3f7c7',
    showUsername: true,
  },
};

let twitchAccessToken = '';

// ── Health check server so Fly doesn't kill us ──
http.createServer((req, res) => {
  handleHttpRequest(req, res).catch((err) => {
    console.error('[ClipWorker] HTTP handler error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  });
}).listen(HEALTH_PORT, '0.0.0.0', () => {
  console.log(`[ClipWorker] Health check on port ${HEALTH_PORT}`);
});

async function handleHttpRequest(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/health')) {
    const ready = Boolean(WORKER_SECRET);
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: ready ? 'ok' : 'not-ready',
      worker: 'clip-worker',
      dependencies: { clipWorkerCredential: ready ? 'configured' : 'unavailable' },
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/banners/generate') {
    await handleBannerGenerationRequest(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

async function handleBannerGenerationRequest(req, res) {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${WORKER_SECRET}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const body = await readJsonBody(req).catch(() => ({}));
  const bannerRequests = normalizeBannerRequests(body);
  const skipCommander = Boolean(body?.skipCommander);
  const commanderName = typeof body?.commanderName === 'string' && body.commanderName.trim()
    ? body.commanderName.trim()
    : 'mtman1987';

  console.log(`[ClipWorker] Generating ${bannerRequests.length} role-aware banners${skipCommander ? '' : ` + commander ${commanderName}`}`);
  const commanderUrl = skipCommander ? null : await generateBanner(commanderName, 'commander');
  let successCount = 0;
  const generatedByVariant = { commander: 0, crew: 0, mountaineer: 0 };
  for (const request of bannerRequests) {
    try {
      await generateBanner(request.username, request.variant);
      successCount += 1;
      generatedByVariant[request.variant] += 1;
    } catch (err) {
      console.error(`[ClipWorker] Banner generation failed for ${request.username}:`, err?.message || err);
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    success: true,
    commanderUrl,
    requestedCount: bannerRequests.length,
    generatedCount: successCount,
    generatedByVariant,
    bannerVersion: BANNER_VERSION,
  }));
}

function normalizeBannerVariant(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (candidate === 'commander' || candidate === 'crew') return candidate;
  return 'mountaineer';
}

function normalizeBannerRequests(body) {
  if (Array.isArray(body?.bannerRequests) && body.bannerRequests.length > 0) {
    return body.bannerRequests
      .filter((request) => request && typeof request.username === 'string' && request.username.trim())
      .map((request) => ({
        username: request.username.trim(),
        variant: normalizeBannerVariant(request.variant),
      }));
  }

  const legacyCrewMembers = Array.isArray(body?.crewMembers) && body.crewMembers.length > 0
    ? body.crewMembers.filter((name) => typeof name === 'string' && name.trim())
    : DEFAULT_CREW_MEMBERS;
  return legacyCrewMembers.map((username) => ({ username: username.trim(), variant: 'crew' }));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// ── Twitch Auth ──
async function getTwitchToken() {
  if (twitchAccessToken) return twitchAccessToken;
  if (!TWITCH_CLIENT_SECRET) {
    console.error('[ClipWorker] No TWITCH_CLIENT_SECRET, cannot get token');
    return '';
  }
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
  });
  if (!res.ok) throw new Error(`Twitch auth failed: ${res.status}`);
  const data = await res.json();
  twitchAccessToken = data.access_token;
  // Refresh before expiry. setTimeout is capped at a signed 32-bit ms value.
  const refreshMs = Math.max(60_000, Math.min((Number(data.expires_in || 3600) - 300) * 1000, 2_000_000_000));
  setTimeout(() => { twitchAccessToken = ''; }, refreshMs);
  return twitchAccessToken;
}

async function fetchBannerTemplate(templatePath) {
  const url = `${DSH_URL.replace(/\/$/, '')}${templatePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch banner template ${templatePath}: ${res.status}`);
  }
  return res.text();
}

async function renderBannerGifFromHtml(html, bannerName) {
  const renderId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const safeBannerName = String(bannerName || 'banner').replace(/[^a-z0-9_-]/gi, '_').slice(0, 64);
  const frameDir = path.join(os.tmpdir(), `banner_${safeBannerName}_${renderId}_frames`);
  const tempHtml = path.join(os.tmpdir(), `banner_${safeBannerName}_${renderId}.html`);
  const tempGif = path.join(os.tmpdir(), `banner_${safeBannerName}_${renderId}.gif`);
  const palette = path.join(os.tmpdir(), `banner_${safeBannerName}_${renderId}_palette.png`);
  const framePaths = [];
  let browser;

  try {
    await fs.mkdir(frameDir, { recursive: true });
    await fs.writeFile(tempHtml, html);
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    });

    const page = await browser.newPage();
    await page.setViewport({ width: BANNER_WIDTH, height: BANNER_HEIGHT, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        animation.pause();
        animation.currentTime = 0;
      }
    });

    const frameCount = Math.floor(BANNER_DURATION_SECONDS * BANNER_FPS);
    for (let i = 0; i < frameCount; i++) {
      const framePath = path.join(frameDir, `frame_${String(i).padStart(3, '0')}.png`);
      const animationTimeMs = (i * 1000) / BANNER_FPS;
      await page.evaluate((currentTimeMs) => {
        for (const animation of document.getAnimations()) {
          animation.currentTime = currentTimeMs;
        }
      }, animationTimeMs);
      const screenshot = await page.screenshot({ type: 'png' });
      await fs.writeFile(framePath, screenshot);
      framePaths.push(framePath);
    }

    await browser.close();
    browser = null;

    const framePattern = path.join(frameDir, 'frame_%03d.png');
    await execAsync(`ffmpeg -y -framerate ${BANNER_FPS} -i "${framePattern}" -vf "palettegen=max_colors=96:stats_mode=diff" "${palette}"`);
    await execAsync(`ffmpeg -y -framerate ${BANNER_FPS} -i "${framePattern}" -i "${palette}" -filter_complex "paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 -gifflags +transdiff "${tempGif}"`);

    const gifBuffer = await fs.readFile(tempGif);
    return gifBuffer;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await fs.unlink(tempHtml).catch(() => {});
    await fs.unlink(tempGif).catch(() => {});
    await fs.unlink(palette).catch(() => {});
    for (const framePath of framePaths) {
      await fs.unlink(framePath).catch(() => {});
    }
    await fs.rm(frameDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function pushBannerToDSH(gifBuffer, bannerName, variant) {
  const form = new FormData();
  form.append('gif', new Blob([gifBuffer], { type: 'image/gif' }), `${bannerName}.gif`);
  form.append('bannerName', bannerName);
  form.append('bannerVariant', normalizeBannerVariant(variant));
  form.append('bannerVersion', BANNER_VERSION);

  const res = await fetch(`${DSH_URL.replace(/\/$/, '')}/api/clips/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WORKER_SECRET}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Banner upload failed: ${res.status} ${err}`);
  }

  return res.json();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fillBannerTemplate(template, username, variant) {
  const normalizedVariant = normalizeBannerVariant(variant);
  const appearance = BANNER_VARIANTS[normalizedVariant];
  const escapedUsername = escapeHtml(username.toUpperCase());
  const identityHtml = appearance.showUsername
    ? ` <span class="separator">&bull;</span> <span class="username">${escapedUsername}</span>`
    : '';
  return template
    .replace(/{{LABEL_HTML}}/g, appearance.labelHtml)
    .replace(/{{IDENTITY_HTML}}/g, identityHtml)
    .replace(/{{MESSAGE_HTML}}/g, appearance.messageHtml)
    .replace(/{{PRIMARY_COLOR}}/g, appearance.primaryColor)
    .replace(/{{SECONDARY_COLOR}}/g, appearance.secondaryColor);
}

async function generateBanner(username, variant) {
  const normalizedVariant = normalizeBannerVariant(variant);
  const template = await fetchBannerTemplate('/banner-template.html');
  const html = fillBannerTemplate(template, username, normalizedVariant);
  const gifBuffer = await renderBannerGifFromHtml(html, username.toLowerCase());
  const result = await pushBannerToDSH(gifBuffer, username.toLowerCase(), normalizedVariant);
  console.log(`[ClipWorker] Generated ${normalizedVariant} banner for ${username}: ${result.gifUrl} (${(gifBuffer.length / 1024).toFixed(0)}KB)`);
  return result.gifUrl;
}

// ── Twitch API helpers ──
async function getUserByLogin(login) {
  const token = await getTwitchToken();
  const res = await fetch(`https://api.twitch.tv/helix/users?login=${login}`, {
    headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.[0] || null;
}

async function getClips(broadcasterId, count = 100) {
  const token = await getTwitchToken();
  const res = await fetch(
    `https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}&first=${count}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

// ── GraphQL clip URL extraction (matches DSH's clip-url-finder.ts) ──
async function getClipVideoUrl(clipSlug) {
  try {
    const gqlQuery = {
      query: `{
        clip(slug: "${clipSlug}") {
          playbackAccessToken(params: {platform: "web", playerType: "embed"}) {
            signature
            value
          }
          videoQualities {
            frameRate
            quality
            sourceURL
          }
        }
      }`
    };

    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(gqlQuery),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const clip = data?.data?.clip;
    if (!clip?.videoQualities?.length) return null;
    const best = clip.videoQualities.sort((a, b) => parseInt(b.quality) - parseInt(a.quality))[0];
    return {
      url: best.sourceURL,
      token: clip.playbackAccessToken?.value,
      signature: clip.playbackAccessToken?.signature,
    };
  } catch {
    return null;
  }
}

// ── GIF conversion (full quality) ──
async function convertClipToGif(clipUrl, clipId, streamerName) {
  const tempMp4 = path.join(os.tmpdir(), `${clipId}.mp4`);
  const tempGif = path.join(os.tmpdir(), `${clipId}.gif`);
  const palette = path.join(os.tmpdir(), `${clipId}_palette.png`);

  try {
    // Extract slug — Helix API clip.id IS the slug
    const slug = clipId;

    // Get video URL
    const urlData = await getClipVideoUrl(slug);
    if (!urlData) {
      console.log(`[ClipWorker] No video URL for ${clipId}`);
      return null;
    }

    // Build download URL
    let downloadUrl = urlData.url;
    if (urlData.token && urlData.signature) {
      const u = new URL(urlData.url);
      u.searchParams.set('sig', urlData.signature);
      u.searchParams.set('token', urlData.token);
      downloadUrl = u.toString();
    }

    // Download with timeout
    console.log(`[ClipWorker] Downloading ${streamerName}/${clipId}...`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const mp4Res = await fetch(downloadUrl, {
      signal: controller.signal,
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://www.twitch.tv/',
        Origin: 'https://www.twitch.tv',
      },
    });
    clearTimeout(timeout);

    if (!mp4Res.ok) {
      console.log(`[ClipWorker] Download failed: ${mp4Res.status}`);
      return null;
    }

    const buf = Buffer.from(await mp4Res.arrayBuffer());
    await fs.writeFile(tempMp4, buf);
    console.log(`[ClipWorker] Downloaded ${(buf.length / 1024 / 1024).toFixed(1)}MB`);

    // Convert — full quality, 480px, 12fps
    console.log(`[ClipWorker] Converting to GIF...`);
    await execAsync(`ffmpeg -y -i "${tempMp4}" -vf "fps=12,scale=480:-1:flags=lanczos,palettegen" "${palette}"`);
    await execAsync(`ffmpeg -y -i "${tempMp4}" -i "${palette}" -filter_complex "fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 "${tempGif}"`);

    const gifBuf = await fs.readFile(tempGif);
    console.log(`[ClipWorker] GIF ready: ${(gifBuf.length / 1024).toFixed(0)}KB`);
    return gifBuf;
  } catch (err) {
    console.error(`[ClipWorker] Convert error for ${streamerName}:`, err.message || err);
    return null;
  } finally {
    await fs.unlink(tempMp4).catch(() => {});
    await fs.unlink(tempGif).catch(() => {});
    await fs.unlink(palette).catch(() => {});
  }
}

// ── Puppeteer live recording fallback ──
async function recordLiveStream(twitchLogin) {
  let browser;
  try {
    const puppeteer = require('puppeteer-core');
    console.log(`[ClipWorker] Recording live stream for ${twitchLogin}...`);
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`https://player.twitch.tv/?channel=${twitchLogin}&parent=localhost&muted=true`, {
      waitUntil: 'networkidle2', timeout: 30000,
    });
    await page.waitForSelector('video', { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    // Click through overlays
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const btn = document.querySelector('button[data-a-target="content-classification-gate-overlay-start-watching-button"]');
        if (btn) { btn.click(); return; }
        const overlay = document.querySelector('[data-a-target="player-overlay-click-handler"]');
        if (overlay) { overlay.click(); return; }
        const play = document.querySelector('[data-a-target="player-play-pause-button"]');
        if (play) play.click();
      });
      await new Promise(r => setTimeout(r, 2000));
    }
    await page.click('video').catch(() => {});
    await new Promise(r => setTimeout(r, 5000));

    const isPlaying = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v && !v.paused && v.readyState >= 2;
    });
    if (!isPlaying) {
      console.log(`[ClipWorker] Video not playing for ${twitchLogin}`);
      return [];
    }

    const gifs = [];
    for (let i = 0; i < 2; i++) {
      const frameDir = path.join(os.tmpdir(), `frames_${twitchLogin}_${Date.now()}`);
      const tempGif = path.join(os.tmpdir(), `live_${twitchLogin}_${Date.now()}.gif`);
      const palette = path.join(os.tmpdir(), `pal_${twitchLogin}_${Date.now()}.png`);
      await fs.mkdir(frameDir, { recursive: true });

      try {
        const fps = 10;
      const totalFrames = fps * 60; // full 60-second fallback clip
        for (let f = 0; f < totalFrames; f++) {
          const frame = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1280, height: 720 } });
          await fs.writeFile(path.join(frameDir, `frame_${String(f).padStart(5, '0')}.png`), frame);
          await new Promise(r => setTimeout(r, 1000 / fps));
        }

        await execAsync(`ffmpeg -y -framerate ${fps} -i "${path.join(frameDir, 'frame_%05d.png')}" -vf "fps=${fps},scale=480:-1:flags=lanczos,palettegen" "${palette}"`);
        await execAsync(`ffmpeg -y -framerate ${fps} -i "${path.join(frameDir, 'frame_%05d.png')}" -i "${palette}" -filter_complex "fps=${fps},scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse" -loop 0 "${tempGif}"`);

        gifs.push(await fs.readFile(tempGif));
        console.log(`[ClipWorker] Recorded GIF ${i + 1}/2 for ${twitchLogin}`);
      } catch (e) {
        console.error(`[ClipWorker] Recording ${i + 1} failed:`, e.message);
      } finally {
        await fs.unlink(palette).catch(() => {});
        await fs.unlink(tempGif).catch(() => {});
        const frames = await fs.readdir(frameDir).catch(() => []);
        for (const f of frames) await fs.unlink(path.join(frameDir, f)).catch(() => {});
        await fs.rmdir(frameDir).catch(() => {});
      }

      if (i === 0 && gifs.length > 0) await new Promise(r => setTimeout(r, 5000));
    }

    return gifs;
  } catch (err) {
    console.error(`[ClipWorker] Live record error:`, err.message);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── Push GIF to DSH ──
async function pushGifToDSH(gifBuffer, streamerName) {
  const form = new FormData();
  form.append('gif', new Blob([gifBuffer], { type: 'image/gif' }), `${Date.now()}.gif`);
  form.append('streamer', streamerName);

  const res = await fetch(`${DSH_URL}/api/clips/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WORKER_SECRET}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  console.log(`[ClipWorker] Pushed ${streamerName}: ${data.gifUrl}`);
  return data.gifUrl;
}

// ── Nebula Arcade gameplay capture ──
async function uploadNebulaGameplay(gifBuffer, game) {
  const form = new FormData();
  form.append('gif', new Blob([gifBuffer], { type: 'image/gif' }), `${game.id}.gif`);
  form.append('nebulaGameId', game.id);
  form.append('nebulaGameName', game.name);
  form.append('nebulaOrder', String(game.order));
  form.append('nebulaRevision', game.revision);
  form.append('nebulaCaptureSeconds', String(game.captureSeconds));
  form.append('nebulaSourceUrl', game.captureUrl);

  const response = await fetch(`${DSH_URL}/api/clips/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WORKER_SECRET}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Nebula upload failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function recordNebulaGameplay(game) {
  const safeId = String(game.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64);
  if (!safeId) throw new Error('Invalid Nebula game id');
  const durationSeconds = Math.min(60, Math.max(1, Number(game.captureSeconds) || 60));
  const captureId = `${safeId}_${Date.now()}`;
  const frameDir = path.join(os.tmpdir(), `nebula_frames_${captureId}`);
  const tempGif = path.join(os.tmpdir(), `nebula_${captureId}.gif`);
  const palette = path.join(os.tmpdir(), `nebula_${captureId}_palette.png`);
  let browser;

  try {
    console.log(`[ClipWorker] Recording ${durationSeconds}s of ${game.name} gameplay...`);
    await fs.mkdir(frameDir, { recursive: true });
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    });
    const page = await browser.newPage();
    await page.setViewport({ width: NEBULA_CAPTURE_WIDTH, height: NEBULA_CAPTURE_HEIGHT, deviceScaleFactor: 1 });
    await page.goto(game.captureUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const totalFrames = durationSeconds * NEBULA_CAPTURE_FPS;
    const startedAt = Date.now();
    for (let frame = 0; frame < totalFrames; frame++) {
      const buffer = await page.screenshot({
        type: 'jpeg',
        quality: 72,
        clip: { x: 0, y: 0, width: NEBULA_CAPTURE_WIDTH, height: NEBULA_CAPTURE_HEIGHT },
      });
      await fs.writeFile(path.join(frameDir, `frame_${String(frame).padStart(5, '0')}.jpg`), buffer);
      const waitMs = startedAt + ((frame + 1) * 1000 / NEBULA_CAPTURE_FPS) - Date.now();
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const framePattern = path.join(frameDir, 'frame_%05d.jpg');
    await execAsync(`ffmpeg -y -framerate ${NEBULA_CAPTURE_FPS} -i "${framePattern}" -vf "fps=${NEBULA_CAPTURE_FPS},scale=480:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" "${palette}"`);
    await execAsync(`ffmpeg -y -framerate ${NEBULA_CAPTURE_FPS} -i "${framePattern}" -i "${palette}" -filter_complex "fps=${NEBULA_CAPTURE_FPS},scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "${tempGif}"`);
    const gifBuffer = await fs.readFile(tempGif);
    const uploaded = await uploadNebulaGameplay(gifBuffer, { ...game, id: safeId, captureSeconds: durationSeconds });
    console.log(`[ClipWorker] Nebula gameplay ready: ${game.name} (${(gifBuffer.length / 1024 / 1024).toFixed(1)}MB) ${uploaded.gifUrl}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await fs.unlink(tempGif).catch(() => {});
    await fs.unlink(palette).catch(() => {});
    await fs.rm(frameDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function processNebulaGameplayBatch() {
  try {
    const response = await fetch(`${DSH_URL}/api/clips/nebula/needed`, {
      headers: { Authorization: `Bearer ${WORKER_SECRET}` },
    });
    if (!response.ok) {
      console.warn(`[ClipWorker] Nebula gameplay manifest unavailable: ${response.status}`);
      return;
    }
    const body = await response.json();
    const needed = Array.isArray(body.needed) ? body.needed : [];
    console.log(`[ClipWorker] Nebula gameplay: ${body.readyGames || 0}/${body.totalGames || 0} ready, ${needed.length} queued this cycle`);
    for (const game of needed) {
      try {
        await recordNebulaGameplay(game);
      } catch (error) {
        console.error(`[ClipWorker] Nebula gameplay capture failed for ${game.name || game.id}:`, error.message || error);
      }
    }
  } catch (error) {
    console.error('[ClipWorker] Nebula gameplay batch failed:', error.message || error);
  }
}

// ── Main loop ──
// ── Stale folder cleanup (30 days no live = delete folder) ──
async function cleanStaleFolders() {
  try {
    if (process.env.DISABLE_STALE_CLIP_CLEANUP === 'true') {
      console.log('[ClipWorker] Stale folder cleanup disabled');
      return;
    }

    console.log('[ClipWorker] Checking for stale clip folders...');
    const res = await fetch(`${DSH_URL}/api/clips/stale?serverId=${SERVER_ID}`, {
      headers: { Authorization: `Bearer ${WORKER_SECRET}` },
    });
    if (!res.ok) return;
    const { stale } = await res.json();
    if (!stale || stale.length === 0) {
      console.log('[ClipWorker] No stale folders found');
      return;
    }
    for (const streamer of stale) {
      try {
        await fetch(`${DSH_URL}/api/clips/upload`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${WORKER_SECRET}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ streamer: streamer.twitchLogin, reason: 'orphan-folder-cleanup' }),
        });
        console.log(`[ClipWorker] Cleaned stale folder: ${streamer.twitchLogin} (${streamer.reason || 'stale'}, newest file: ${streamer.newestFile || 'unknown'})`);
      } catch (e) {
        console.error(`[ClipWorker] Failed to clean ${streamer.twitchLogin}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[ClipWorker] Stale cleanup error:', e.message);
  }
}

async function processStreamer(streamer) {
  console.log(`[ClipWorker] Processing ${streamer.twitchLogin} (${streamer.group}, ${streamer.existingGifs} existing GIFs)`);

  const user = await getUserByLogin(streamer.twitchLogin);
  if (!user) {
    console.log(`[ClipWorker] Twitch user not found: ${streamer.twitchLogin}`);
    return;
  }

  const clips = await getClips(user.id, 100);
  let successCount = 0;

  if (clips.length > 0) {
    console.log(`[ClipWorker] Found ${clips.length} clips for ${streamer.twitchLogin}`);
    // Try newest 5 first
    const sorted = clips.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    for (const clip of sorted) {
      if (successCount >= GIFS_PER_STREAMER) break;
      const gifBuf = await convertClipToGif(clip.url, clip.id, streamer.twitchLogin);
      if (gifBuf) {
        await pushGifToDSH(gifBuf, streamer.twitchLogin);
        successCount++;
        console.log(`[ClipWorker] ${successCount}/${GIFS_PER_STREAMER} for ${streamer.twitchLogin}`);
      }
    }

    // Try popular if needed
    if (successCount < GIFS_PER_STREAMER) {
      const popular = clips.sort((a, b) => b.view_count - a.view_count).slice(0, 5);
      for (const clip of popular) {
        if (successCount >= GIFS_PER_STREAMER) break;
        const gifBuf = await convertClipToGif(clip.url, clip.id, streamer.twitchLogin);
        if (gifBuf) {
          await pushGifToDSH(gifBuf, streamer.twitchLogin);
          successCount++;
        }
      }
    }
  }

  // Fallback: record live stream
  if (successCount === 0) {
    console.log(`[ClipWorker] No clips worked, recording live for ${streamer.twitchLogin}...`);
    const gifs = await recordLiveStream(streamer.twitchLogin);
    for (const gifBuf of gifs) {
      await pushGifToDSH(gifBuf, streamer.twitchLogin);
      successCount++;
    }
  }

  // Tell DSH to update the cooldown
  if (successCount > 0) {
    await fetch(`${DSH_URL}/api/clips/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WORKER_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ markCooldown: true, serverId: SERVER_ID, discordUserId: streamer.discordUserId }),
    }).catch(() => {});
  }

  console.log(`[ClipWorker] Done ${streamer.twitchLogin}: ${successCount} GIFs`);
}

let lastStaleCleanup = 0;
const STALE_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
let cycleRunning = false;

async function runCycle() {
  if (cycleRunning) {
    console.log('[ClipWorker] Previous cycle still running, skipping this tick');
    return;
  }

  cycleRunning = true;
  try {
    console.log(`[ClipWorker] ── Starting cycle ──`);

    // Stale cleanup once per hour
    if (Date.now() - lastStaleCleanup > STALE_CLEANUP_INTERVAL) {
      await cleanStaleFolders();
      lastStaleCleanup = Date.now();
    }

    // Reuse the same GIF worker and volume for Nebula Arcade's gameplay showcase.
    await processNebulaGameplayBatch();

    const res = await fetch(`${DSH_URL}/api/clips/needed?serverId=${SERVER_ID}`, {
      headers: { Authorization: `Bearer ${WORKER_SECRET}` },
    });

    if (!res.ok) {
      console.error(`[ClipWorker] Failed to get needed list: ${res.status}`);
      return;
    }

    const { needed } = await res.json();
    console.log(`[ClipWorker] ${needed.length} streamers need clips`);

    for (const streamer of needed) {
      await processStreamer(streamer);
    }

    console.log(`[ClipWorker] ── Cycle complete ──`);
  } catch (err) {
    console.error('[ClipWorker] Cycle error:', err.message || err);
  } finally {
    cycleRunning = false;
  }
}

// ── Start ──
console.log('[ClipWorker] Starting clip worker...');
console.log(`[ClipWorker] DSH: ${DSH_URL}`);
console.log(`[ClipWorker] Server: ${SERVER_ID}`);
console.log(`[ClipWorker] Poll interval: ${POLL_INTERVAL / 1000}s`);

runCycle();
setInterval(runCycle, POLL_INTERVAL);
