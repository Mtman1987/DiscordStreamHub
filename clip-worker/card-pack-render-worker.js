#!/usr/bin/env node

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const execAsync = promisify(exec);
const DSH_URL = String(process.env.DSH_URL || 'https://discord-stream-hub-new.fly.dev').replace(/\/$/, '');
const WORKER_SECRET = String(process.env.CLIP_WORKER_SECRET || '').trim();
const POLL_MS = 15_000;
const WIDTH = 960;
const HEIGHT = 540;
const FPS = 10;
const DURATION_SECONDS = 14;
let running = false;

async function failJob(id, error) {
  if (!id) return;
  await fetch(`${DSH_URL}/api/internal/card-pack/render/fail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WORKER_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id, error: String(error?.message || error || 'render failed') }),
  }).catch(() => {});
}

async function capture(job) {
  const safeId = String(job.id || '').toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, 120);
  if (!safeId) throw new Error('Invalid render job id');
  const frameDir = path.join(os.tmpdir(), `pack_frames_${safeId}_${Date.now()}`);
  const tempGif = path.join(os.tmpdir(), `pack_${safeId}_${Date.now()}.gif`);
  const palette = path.join(os.tmpdir(), `pack_${safeId}_${Date.now()}_palette.png`);
  let browser;
  try {
    await fs.mkdir(frameDir, { recursive: true });
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.goto(job.renderUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const totalFrames = FPS * DURATION_SECONDS;
    const startedAt = Date.now();
    for (let frame = 0; frame < totalFrames; frame++) {
      const bytes = await page.screenshot({
        type: 'jpeg',
        quality: 78,
        clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      });
      await fs.writeFile(path.join(frameDir, `frame_${String(frame).padStart(5, '0')}.jpg`), bytes);
      const waitMs = startedAt + ((frame + 1) * 1000 / FPS) - Date.now();
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const pattern = path.join(frameDir, 'frame_%05d.jpg');
    await execAsync(`ffmpeg -y -framerate ${FPS} -i "${pattern}" -vf "fps=${FPS},scale=640:-1:flags=lanczos,palettegen=max_colors=160:stats_mode=diff" "${palette}"`);
    await execAsync(`ffmpeg -y -framerate ${FPS} -i "${pattern}" -i "${palette}" -filter_complex "fps=${FPS},scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "${tempGif}"`);

    const gif = await fs.readFile(tempGif);
    const form = new FormData();
    form.append('id', safeId);
    form.append('gif', new Blob([gif], { type: 'image/gif' }), `${safeId}.gif`);
    const response = await fetch(`${DSH_URL}/api/internal/card-pack/render/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WORKER_SECRET}` },
      body: form,
    });
    if (!response.ok) throw new Error(`complete failed ${response.status}: ${await response.text()}`);
    const body = await response.json();
    console.log(`[CardPackRender] Ready ${safeId}: ${body?.job?.gifUrl || ''}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await fs.unlink(tempGif).catch(() => {});
    await fs.unlink(palette).catch(() => {});
    await fs.rm(frameDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function tick() {
  if (running || !WORKER_SECRET) return;
  running = true;
  let job = null;
  try {
    const response = await fetch(`${DSH_URL}/api/internal/card-pack/render/next`, {
      headers: { Authorization: `Bearer ${WORKER_SECRET}` },
    });
    if (!response.ok) {
      console.warn(`[CardPackRender] Queue unavailable: ${response.status}`);
      return;
    }
    const body = await response.json();
    job = body?.job || null;
    if (!job) return;
    console.log(`[CardPackRender] Recording ${job.source || 'pack'} ${job.id}`);
    await capture(job);
  } catch (error) {
    console.error('[CardPackRender] Failed:', error?.message || error);
    await failJob(job?.id, error);
  } finally {
    running = false;
  }
}

console.log(`[CardPackRender] Polling ${DSH_URL} every ${POLL_MS / 1000}s`);
tick();
setInterval(tick, POLL_MS);
