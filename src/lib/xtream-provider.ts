import type { ReadableStream } from 'node:stream/web';

export type XtreamKind = 'vod' | 'live' | 'series';

type XtreamStream = {
  stream_id?: number | string;
  series_id?: number | string;
  name?: string;
  title?: string;
  stream_icon?: string;
  cover?: string;
  container_extension?: string;
  stream_type?: string;
  year?: string;
  added?: string;
};

type XtreamSeriesInfo = {
  episodes?: unknown;
};

type XtreamCatalogItem = {
  id: string;
  type: 'movie' | 'live';
  title: string;
  year: number;
  runtime: string;
  source: string;
  poster: string;
  playbackUrl: string;
  overview: string;
};

let cachedStreams: { expiresAt: number; items: XtreamCatalogItem[] } | null = null;

const MOCK_CATALOG: XtreamCatalogItem[] = [
  {
    id: 'xtream-mock-bbb',
    type: 'movie',
    title: 'Xtream Mock: Big Buck Bunny',
    year: 2008,
    runtime: '10m',
    source: 'Xtream mock provider',
    poster: 'https://peach.blender.org/wp-content/uploads/title_anouncement.jpg',
    playbackUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    overview: 'Mock Xtream VOD result that exercises provider search and playback.',
  },
  {
    id: 'xtream-mock-sintel',
    type: 'movie',
    title: 'Xtream Mock: Sintel',
    year: 2010,
    runtime: '15m',
    source: 'Xtream mock provider',
    poster: 'https://durian.blender.org/wp-content/uploads/2010/05/sintel_poster.jpg',
    playbackUrl: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
    overview: 'Mock Xtream VOD result using a public HLS asset.',
  },
  {
    id: 'xtream-mock-live',
    type: 'live',
    title: 'Xtream Mock: Live HLS Channel',
    year: 2026,
    runtime: 'live',
    source: 'Xtream mock provider',
    poster: '',
    playbackUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    overview: 'Mock Xtream live channel for end-to-end Discord Activity testing.',
  },
];

function isMockEnabled() {
  return process.env.XTREAM_MOCK === 'true';
}

function isSeriesSearchEnabled() {
  return process.env.XTREAM_ENABLE_SERIES === 'true';
}

function getConfig() {
  const baseUrl = process.env.XTREAM_BASE_URL?.replace(/\/$/, '');
  const username = process.env.XTREAM_USERNAME;
  const password = process.env.XTREAM_PASSWORD;
  if (!baseUrl || !username || !password) return null;
  return { baseUrl, username, password };
}

export function isXtreamConfigured() {
  return isMockEnabled() || Boolean(getConfig());
}

export function isXtreamMockEnabled() {
  return isMockEnabled();
}

function playerApiUrl(action?: string) {
  const config = getConfig();
  if (!config) throw new Error('Xtream provider is not configured');
  const url = new URL('/player_api.php', config.baseUrl);
  url.searchParams.set('username', config.username);
  url.searchParams.set('password', config.password);
  if (action) url.searchParams.set('action', action);
  return url;
}

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function scoreItem(item: XtreamCatalogItem, query: string) {
  const needle = normalize(query);
  const words = needle.split(/\s+/).filter((word) => word.length >= 3 && !['the', 'and'].includes(word));
  const title = normalize(item.title);
  const overview = normalize(item.overview);
  const isVod = item.id.startsWith('xtream-vod-');
  const isSeries = item.id.startsWith('xtream-series-');
  const isMovieSearch = !words.some((word) => ['show', 'series', 'season', 'episode'].includes(word));
  let score = 0;
  if (title === needle) score += 100;
  if (title.includes(needle)) score += 50;
  for (const word of words) {
    if (title.includes(word)) score += 8;
    if (overview.includes(word)) score += 2;
  }
  if (score === 0) return 0;
  if (isVod) score += 25;
  if (overview.includes('(mp4)')) score += 12;
  if (overview.includes('(mkv)')) score -= 20;
  if (isSeries && isMovieSearch) score -= 30;
  return score;
}

function streamYear(stream: XtreamStream) {
  const parsed = Number(stream.year);
  if (Number.isFinite(parsed) && parsed > 1900) return parsed;
  return new Date().getFullYear();
}

function toCatalogItem(stream: XtreamStream, kind: XtreamKind): XtreamCatalogItem | null {
  const streamId = kind === 'series' ? stream.series_id : stream.stream_id;
  const title = stream.name || stream.title;
  if (!streamId || !title) return null;

  const extension = String(stream.container_extension || (kind === 'live' ? 'ts' : 'mp4')).toLowerCase();
  if (kind === 'vod' && !['mp4', 'm4v', 'mov', 'm3u8', 'ts', 'mkv'].includes(extension)) return null;

  return {
    id: `xtream-${kind}-${streamId}`,
    type: kind === 'live' ? 'live' : 'movie',
    title: kind === 'series' ? `${title} - first episode` : title,
    year: streamYear(stream),
    runtime: kind === 'live' ? 'live' : kind === 'series' ? 'series' : 'unknown',
    source: 'Xtream IPTV provider',
    poster: stream.stream_icon || stream.cover || '',
    playbackUrl: `/activity-provider/xtream/${kind}/${streamId}`,
    overview: kind === 'series' ? 'Xtream SERIES result; starts from the first available episode.' : `Xtream ${kind.toUpperCase()} stream${extension ? ` (${extension})` : ''}.`,
  };
}

async function fetchXtreamJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Xtream API returned ${response.status}`);
  return response.json() as Promise<T>;
}

export async function getXtreamStatus() {
  if (isMockEnabled()) {
    return {
      configured: true,
      mock: true,
      userInfo: { username: 'xtream-mock', status: 'Active' },
      serverInfo: { url: 'mock://xtream-compatible-test' },
    };
  }
  if (!isXtreamConfigured()) return { configured: false };
  const payload = await fetchXtreamJson<Record<string, unknown>>(playerApiUrl());
  const userInfo = payload.user_info && typeof payload.user_info === 'object'
    ? { ...(payload.user_info as Record<string, unknown>) }
    : payload.user_info || null;
  if (userInfo && typeof userInfo === 'object') delete (userInfo as Record<string, unknown>).password;
  return {
    configured: true,
    userInfo,
    serverInfo: payload.server_info || null,
  };
}

async function getXtreamCatalog() {
  if (isMockEnabled()) return MOCK_CATALOG;
  if (!isXtreamConfigured()) return [];
  if (cachedStreams && cachedStreams.expiresAt > Date.now()) return cachedStreams.items;

  const [vod, live, series] = await Promise.all([
    fetchXtreamJson<XtreamStream[]>(playerApiUrl('get_vod_streams')).catch(() => []),
    fetchXtreamJson<XtreamStream[]>(playerApiUrl('get_live_streams')).catch(() => []),
    isSeriesSearchEnabled() ? fetchXtreamJson<XtreamStream[]>(playerApiUrl('get_series')).catch(() => []) : Promise.resolve([]),
  ]);

  const items = [
    ...series.map((stream) => toCatalogItem(stream, 'series')),
    ...vod.map((stream) => toCatalogItem(stream, 'vod')),
    ...live.slice(0, 500).map((stream) => toCatalogItem(stream, 'live')),
  ].filter((item): item is XtreamCatalogItem => Boolean(item));

  cachedStreams = { expiresAt: Date.now() + 5 * 60 * 1000, items };
  return items;
}

export async function searchXtreamCatalog(query: string | null | undefined) {
  const needle = normalize(query);
  if (!needle) return [];
  const items = await getXtreamCatalog();
  const matches = items
    .map((item) => ({ item, score: scoreItem(item, needle) }))
    .filter((entry) => entry.score >= 16)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((entry) => entry.item);

  const playable: XtreamCatalogItem[] = [];
  for (const item of matches) {
    if (item.id.startsWith('xtream-vod-')) {
      const isPlayable = await isPlayableVodItem(item);
      if (isPlayable) {
        playable.push(item);
      } else {
        console.warn(`[Xtream] Skipping unplayable VOD result: ${item.title} (${item.id})`);
      }
      continue;
    }

    if (!item.id.startsWith('xtream-series-')) {
      playable.push(item);
      continue;
    }

    const seriesId = item.id.replace('xtream-series-', '');
    const hasEpisode = await getFirstSeriesEpisodeUrl(seriesId).then(() => true).catch(() => false);
    if (hasEpisode) {
      playable.push(item);
    } else {
      console.warn(`[Xtream] Skipping unplayable series result: ${item.title} (${seriesId})`);
    }
  }

  return playable;
}

async function isPlayableVodItem(item: XtreamCatalogItem) {
  const streamId = item.id.replace('xtream-vod-', '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(getXtreamStreamUrl('vod', streamId), {
      cache: 'no-store',
      headers: {
        range: 'bytes=0-0',
        'user-agent': 'DiscordStreamHub/1.0',
      },
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    if (!response.ok && response.status !== 206) return false;
    if (contentType.includes('text/html') || contentType.includes('application/json')) return false;
    return contentType.startsWith('video/') || contentType.includes('octet-stream');
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function getXtreamStreamUrl(kind: XtreamKind, streamId: string) {
  const config = getConfig();
  if (!config) throw new Error('Xtream provider is not configured');
  const cleanId = String(streamId).replace(/[^0-9]/g, '');
  if (!cleanId) throw new Error('Invalid Xtream stream id');
  const extension = kind === 'live' ? 'ts' : 'mp4';
  const pathKind = kind === 'live' ? 'live' : kind === 'series' ? 'series' : 'movie';
  return new URL(`/${pathKind}/${encodeURIComponent(config.username)}/${encodeURIComponent(config.password)}/${cleanId}.${extension}`, config.baseUrl);
}

async function getFirstSeriesEpisodeUrl(seriesId: string) {
  const config = getConfig();
  if (!config) throw new Error('Xtream provider is not configured');
  const cleanSeriesId = String(seriesId).replace(/[^0-9]/g, '');
  if (!cleanSeriesId) throw new Error('Invalid Xtream series id');

  const url = playerApiUrl('get_series_info');
  url.searchParams.set('series_id', cleanSeriesId);
  const info = await fetchXtreamJson<XtreamSeriesInfo>(url);
  const episodes = flattenSeriesEpisodes(info.episodes);

  if (episodes.length === 0) {
    const episodeShape = info.episodes && typeof info.episodes === 'object'
      ? {
          topKeys: Object.keys(info.episodes as Record<string, unknown>).slice(0, 5),
          firstValueType: (() => {
            const firstValue = Object.values(info.episodes as Record<string, unknown>)[0];
            return Array.isArray(firstValue) ? 'array' : typeof firstValue;
          })(),
        }
      : { type: typeof info.episodes };
    console.warn('[Xtream] No series episodes found in provider response shape:', JSON.stringify(episodeShape));
  }

  for (const episode of episodes) {
    const episodeId = firstStringValue(episode, ['id', 'stream_id', 'episode_id']);
    if (!episodeId) continue;
    const extension = firstStringValue(episode, ['container_extension', 'extension', 'container']) || 'ts';
    const cleanExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'ts';
    return new URL(`/series/${encodeURIComponent(config.username)}/${encodeURIComponent(config.password)}/${episodeId}.${cleanExtension}`, config.baseUrl);
  }

  throw new Error('No playable Xtream series episodes found');
}

function firstStringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null || value === '') continue;
    return String(value);
  }
  return '';
}

function flattenSeriesEpisodes(episodes: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(episodes)) {
    return episodes.flatMap((entry) => flattenSeriesEpisodes(entry));
  }

  if (!episodes || typeof episodes !== 'object') return [];

  const record = episodes as Record<string, unknown>;
  if (firstStringValue(record, ['id', 'stream_id', 'episode_id'])) return [record];

  return Object.keys(record)
    .sort((a, b) => Number(a) - Number(b))
    .flatMap((key) => flattenSeriesEpisodes(record[key]));
}

export async function fetchXtreamStream(kind: XtreamKind, streamId: string, range?: string | null, signal?: AbortSignal) {
  const upstreamUrl = kind === 'series' ? await getFirstSeriesEpisodeUrl(streamId) : getXtreamStreamUrl(kind, streamId);
  const headers: Record<string, string> = { 'user-agent': 'DiscordStreamHub/1.0' };
  if (range) headers.range = range;
  const upstream = await fetch(upstreamUrl, {
    cache: 'no-store',
    headers,
    signal,
  });

  return {
    ok: upstream.ok,
    status: upstream.status,
    body: upstream.body as ReadableStream<Uint8Array> | null,
    contentType: upstream.headers.get('content-type') || (kind === 'live' ? 'video/mp2t' : 'video/mp4'),
    contentLength: upstream.headers.get('content-length'),
    contentRange: upstream.headers.get('content-range'),
    acceptRanges: upstream.headers.get('accept-ranges'),
  };
}
