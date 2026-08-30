'use server';

import puppeteer from 'puppeteer';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { getStoragePath } from './runtime-config.ts';
import {
  BANNER_VARIANTS,
  BANNER_VERSION,
  type BannerVariant,
  bannerStorageKey,
  isStoredBannerCurrent,
  normalizeBannerVariant,
} from './banner-policy.ts';

const execAsync = promisify(exec);
const STORAGE_PATH = getStoragePath();
const BANNER_WIDTH = 960;
const BANNER_HEIGHT = 100;
const BANNER_FPS = 10;
const BANNER_DURATION_SECONDS = 20;
const COMMUNITY_SPOTLIGHT_BANNER_KEY = 'community-spotlight';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fillBannerTemplate(template: string, username: string, variant: BannerVariant): string {
  const appearance = BANNER_VARIANTS[variant];
  const escapedUsername = escapeHtml(username.toUpperCase());
  const identityHtml = appearance.showUsername
    ? ` <span class="separator">&bull;</span> <span class="username">${escapedUsername}</span>`
    : '';
  return template
    .replace(/{{LABEL_HTML}}/g, appearance.labelHtml)
    .replace(/{{IDENTITY_HTML}}/g, identityHtml)
    .replace(/{{MESSAGE_HTML}}/g, appearance.message)
    .replace(/{{PRIMARY_COLOR}}/g, appearance.primaryColor)
    .replace(/{{SECONDARY_COLOR}}/g, appearance.secondaryColor);
}

async function generateBanners(usernames: string[], variant: BannerVariant): Promise<void> {
  const templatePath = join(process.cwd(), 'public', 'banner-template.html');
  const template = await readFile(templatePath, 'utf8');

  for (const username of usernames) {
    try {
      const html = fillBannerTemplate(template, username, variant);
      const gifUrl = await recordBannerToGif(html, username, variant);
      console.log(`[BannerGen] Generated ${variant} banner for ${username}: ${gifUrl}`);
    } catch (error) {
      console.error(`[BannerGen] ${variant} banner failed for ${username}:`, error);
    }
  }
}

export async function generateCrewBanners(crewMembers: string[]): Promise<void> {
  await generateBanners(crewMembers, 'crew');
}

export async function generateMountaineerBanners(members: string[]): Promise<void> {
  await generateBanners(members, 'mountaineer');
}

export async function getCrewBannerUrl(username: string): Promise<string | null> {
  const bannerKey = bannerStorageKey(username);
  if (!bannerKey || !isStoredBannerCurrent(STORAGE_PATH, bannerKey, 'crew')) return null;
  return `/api/media/banners/${bannerKey}.gif?v=${BANNER_VERSION}`;
}

export async function generateCommanderBanner(): Promise<string> {
  const username = 'mtman1987';
  const template = await readFile(join(process.cwd(), 'public', 'banner-template.html'), 'utf8');
  return recordBannerToGif(fillBannerTemplate(template, username, 'commander'), username, 'commander');
}

export async function getCommunitySpotlightBannerUrl(): Promise<string> {
  if (!isStoredBannerCurrent(STORAGE_PATH, COMMUNITY_SPOTLIGHT_BANNER_KEY, 'spotlight')) {
    const template = await readFile(join(process.cwd(), 'public', 'banner-template.html'), 'utf8');
    await recordBannerToGif(
      fillBannerTemplate(template, COMMUNITY_SPOTLIGHT_BANNER_KEY, 'spotlight'),
      COMMUNITY_SPOTLIGHT_BANNER_KEY,
      'spotlight',
    );
  }
  return `/api/media/banners/${COMMUNITY_SPOTLIGHT_BANNER_KEY}.gif?v=${BANNER_VERSION}`;
}

async function recordBannerToGif(
  html: string,
  username: string,
  requestedVariant: BannerVariant,
): Promise<string> {
  const variant = normalizeBannerVariant(requestedVariant);
  const bannerKey = bannerStorageKey(username);
  if (!bannerKey) throw new Error('A valid Twitch login is required to generate a banner');

  const workDir = await mkdtemp(join(tmpdir(), 'dsh-banner-'));
  const frameDir = join(workDir, 'frames');
  const tempGif = join(workDir, 'banner.gif');
  const palettePath = join(workDir, 'palette.png');
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    await mkdir(frameDir, { recursive: true });
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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

    const frameCount = BANNER_DURATION_SECONDS * BANNER_FPS;
    for (let index = 0; index < frameCount; index += 1) {
      const currentTimeMs = (index * 1000) / BANNER_FPS;
      await page.evaluate((animationTimeMs) => {
        for (const animation of document.getAnimations()) {
          animation.currentTime = animationTimeMs;
        }
      }, currentTimeMs);
      await page.screenshot({
        path: join(frameDir, `frame_${String(index).padStart(3, '0')}.png`),
        type: 'png',
      });
    }

    await browser.close();
    browser = null;

    const framePattern = join(frameDir, 'frame_%03d.png');
    await execAsync(`ffmpeg -y -framerate ${BANNER_FPS} -i "${framePattern}" -vf "palettegen=max_colors=96:stats_mode=diff" "${palettePath}"`);
    await execAsync(`ffmpeg -y -framerate ${BANNER_FPS} -i "${framePattern}" -i "${palettePath}" -filter_complex "paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 -gifflags +transdiff "${tempGif}"`);

    const bannersDir = join(STORAGE_PATH, 'banners');
    await mkdir(bannersDir, { recursive: true });
    const gifBuffer = await readFile(tempGif);
    await writeFile(join(bannersDir, `${bannerKey}.gif`), gifBuffer);
    await writeFile(join(bannersDir, `${bannerKey}.gif.meta.json`), JSON.stringify({
      version: BANNER_VERSION,
      variant,
      generatedAt: new Date().toISOString(),
      width: BANNER_WIDTH,
      height: BANNER_HEIGHT,
      fps: BANNER_FPS,
      durationSeconds: BANNER_DURATION_SECONDS,
    }, null, 2));

    return `/api/media/banners/${bannerKey}.gif?v=${BANNER_VERSION}`;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
