import { NextRequest, NextResponse } from 'next/server';
import { getChatTagApiBase } from '@/lib/runtime-config';
import { getClipWorkerSecret } from '@/lib/runtime-secrets';
import { getNebulaGameplayItems, normalizeNebulaGameId } from '@/lib/nebula-gameplay-rotation';

export const dynamic = 'force-dynamic';

type ManifestGame = {
  id: string;
  name: string;
  order: number;
  revision: string;
  captureSeconds: number;
  captureUrl: string;
};

export async function GET(request: NextRequest) {
  const workerSecret = getClipWorkerSecret();
  if (!workerSecret) return NextResponse.json({ error: 'Clip worker credential is not configured' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${workerSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const chatTagBase = getChatTagApiBase().replace(/\/$/, '');
  try {
    const response = await fetch(`${chatTagBase}/api/game-hub/showcase-manifest`, { cache: 'no-store' });
    if (!response.ok) {
      return NextResponse.json({ error: `Nebula manifest unavailable (${response.status})` }, { status: 502 });
    }
    const manifest = await response.json();
    const expectedOrigin = new URL(chatTagBase).origin;
    const games = (Array.isArray(manifest.games) ? manifest.games : [])
      .map((game: ManifestGame) => ({
        id: normalizeNebulaGameId(game.id),
        name: String(game.name || game.id || '').slice(0, 100),
        order: Math.max(0, Number(game.order || 0)),
        revision: String(game.revision || manifest.revision || '').slice(0, 100),
        captureSeconds: Math.min(60, Math.max(1, Number(game.captureSeconds || 60))),
        captureUrl: String(game.captureUrl || ''),
      }))
      .filter((game: ManifestGame) => {
        if (!game.id || !game.captureUrl || !game.revision) return false;
        try { return new URL(game.captureUrl).origin === expectedOrigin; } catch { return false; }
      });

    const current = new Map((await getNebulaGameplayItems()).map((item) => [item.id, item]));
    const needed = games.filter((game: ManifestGame) => current.get(game.id)?.revision !== game.revision).slice(0, 2);
    return NextResponse.json({ needed, totalGames: games.length, readyGames: current.size });
  } catch (error) {
    console.error('[NebulaGameplay] Manifest check failed:', error);
    return NextResponse.json({ error: 'Nebula manifest unavailable' }, { status: 502 });
  }
}
