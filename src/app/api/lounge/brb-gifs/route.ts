import { NextRequest, NextResponse } from 'next/server';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getAppUrl, getStoragePath } from '@/lib/runtime-config';

export const dynamic = 'force-dynamic';

const LOGIN = /^[a-z0-9_]{3,25}$/i;
const GIF = /^[a-zA-Z0-9_-]+\.gif$/;
const RESERVED = new Set(['banners', 'admin-calendar', 'admin-leaderboard', 'nebula-gameplay']);

export async function GET(request: NextRequest) {
  try {
    const storage = getStoragePath();
    const requested = String(request.nextUrl.searchParams.get('users') || '')
      .toLowerCase().split(',').filter((login) => LOGIN.test(login)).slice(0, 20);
    const directories = requested.length
      ? requested
      : (await readdir(storage, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && LOGIN.test(entry.name) && !RESERVED.has(entry.name.toLowerCase()))
        .map((entry) => entry.name).slice(0, 100);
    const base = getAppUrl().replace(/\/$/, '');
    const gifs: { user: string; url: string }[] = [];
    for (const user of directories) {
      const files = (await readdir(join(storage, user)).catch(() => [] as string[]))
        .filter((file) => GIF.test(file)).sort().reverse().slice(0, 4);
      for (const file of files) gifs.push({ user, url: `${base}/api/media/${user}/${file}` });
      if (gifs.length >= 100) break;
    }
    return NextResponse.json({ gifs: gifs.slice(0, 100) }, {
      headers: { 'Cache-Control': 'public, max-age=30', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    console.warn('[BRB GIFs] Storage lookup failed:', error);
    return NextResponse.json({ gifs: [] }, { status: 503 });
  }
}
