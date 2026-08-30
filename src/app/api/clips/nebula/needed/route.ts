import { NextRequest, NextResponse } from 'next/server';
import { getChatTagApiBase } from '@/lib/runtime-config';
import { getClipWorkerSecret } from '@/lib/runtime-secrets';
import {
  deleteNebulaGameplayCapture,
  getNebulaGameplayItems,
  normalizeNebulaGameId,
} from '@/lib/nebula-gameplay-rotation';

export const dynamic = 'force-dynamic';

// Capture exactly one uncached/changed game per worker cycle. With the current
// 20-game catalog, the first 20 cycles fill the cache one game at a time. After
// that this endpoint returns an empty queue until a developer adds a new game
// or changes an existing game's source revision.
const NEBULA_CAPTURE_BATCH_SIZE = 1;

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

    const currentItems = await getNebulaGameplayItems();
    const current = new Map(currentItems.map((item) => [item.id, item]));
    const staleIds = new Set(
      games
        .filter((game: ManifestGame) => {
          const saved = current.get(game.id);
          return Boolean(saved && saved.revision !== game.revision);
        })
        .map((game: ManifestGame) => game.id),
    );

    // A changed source must stop rotating immediately. Otherwise a bad/stale GIF
    // can keep showing for hours while the one-game-per-cycle worker rebuilds the
    // library. Remove only stale revisions; unchanged saved gameplay is preserved.
    if (staleIds.size) {
      await Promise.all([...staleIds].map((id) => deleteNebulaGameplayCapture(id)));
      for (const id of staleIds) current.delete(id);
    }

    const needed = games
      .filter((game: ManifestGame) => current.get(game.id)?.revision !== game.revision)
      .slice(0, NEBULA_CAPTURE_BATCH_SIZE);
    const readyGames = current.size;
    return NextResponse.json({
      needed,
      totalGames: games.length,
      readyGames,
      pendingGames: Math.max(0, games.length - readyGames),
      removedStaleGames: staleIds.size,
      cacheStrategy: 'capture-one-missing-or-changed-game-per-cycle',
    });
  } catch (error) {
    console.error('[NebulaGameplay] Manifest check failed:', error);
    return NextResponse.json({ error: 'Nebula manifest unavailable' }, { status: 502 });
  }
}
