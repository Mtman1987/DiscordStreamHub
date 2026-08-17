const DEFAULT_SPMT_URL = 'https://spmt.live';
const COMMLINK_WINDOW_MINUTES = 10;
const COMMLINK_ITEM_LIMIT = 300;
const MAX_COMMLINK_SNAPSHOT_TEXT = 38_000;

type JsonRecord = Record<string, unknown>;

export type CommlinkDiagnosticSnapshot =
  | {
      status: 'captured';
      endpoint: string;
      scope: 'ecosystem-global';
      itemCount: number;
      snapshotJson: string;
      truncated: boolean;
    }
  | {
      status: 'unavailable';
      endpoint: string;
      scope: 'ecosystem-global';
      error: string;
    };

function baseUrl(): string {
  return String(process.env.SPMT_BASE_URL || process.env.SPMT_URL || DEFAULT_SPMT_URL)
    .trim()
    .replace(/\/$/, '');
}

function safeText(value: unknown, max = 800): string {
  return String(value ?? '')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-|github_pat_)[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/([?&](?:access_token|refresh_token|token|secret|key|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, max);
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function compactPayload(value: unknown): { snapshotJson: string; itemCount: number; truncated: boolean } {
  const source = objectValue(value);
  const items = Array.isArray(source.items) ? [...source.items] : [];
  const itemCount = Number(source.count ?? items.length) || items.length;
  const base: JsonRecord = {
    schemaVersion: source.schemaVersion || 'commlink.diagnostic-feed/v1',
    capturedAt: source.capturedAt || null,
    scope: source.scope || 'ecosystem-global',
    window: source.window || null,
    sourceCounts: source.sourceCounts || null,
    sourceErrors: source.sourceErrors || [],
    totalMatched: source.totalMatched ?? itemCount,
    omittedForBytes: source.omittedForBytes || 0,
  };

  let kept = items.slice(-COMMLINK_ITEM_LIMIT);
  let truncated = Boolean(source.truncated) || items.length > kept.length;
  while (kept.length > 0) {
    const candidate = JSON.stringify({ ...base, count: kept.length, truncated, items: kept });
    if (candidate.length <= MAX_COMMLINK_SNAPSHOT_TEXT) {
      return { snapshotJson: candidate, itemCount, truncated };
    }
    kept.shift();
    truncated = true;
  }

  return {
    snapshotJson: JSON.stringify({ ...base, count: 0, truncated: true, items: [] }).slice(0, MAX_COMMLINK_SNAPSHOT_TEXT),
    itemCount,
    truncated: true,
  };
}

export async function captureCommlinkDiagnosticSnapshot(options: {
  serviceKey: string;
  capturedAt: string;
  source?: string;
}): Promise<CommlinkDiagnosticSnapshot> {
  const endpoint = `${baseUrl()}/api/internal/commlink/diagnostic-feed`;
  if (!options.serviceKey) {
    return { status: 'unavailable', endpoint, scope: 'ecosystem-global', error: 'SPMT service key is unavailable.' };
  }

  const untilMs = Date.parse(options.capturedAt) || Date.now();
  const params = new URLSearchParams({
    since: new Date(untilMs - COMMLINK_WINDOW_MINUTES * 60_000).toISOString(),
    until: new Date(untilMs).toISOString(),
    limit: String(COMMLINK_ITEM_LIMIT),
  });
  if (options.source) params.set('source', options.source);
  const requestUrl = `${endpoint}?${params.toString()}`;

  try {
    const response = await fetch(requestUrl, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${options.serviceKey}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) throw new Error(`Commlink diagnostic feed HTTP ${response.status}`);
    const compacted = compactPayload(payload);
    return {
      status: 'captured',
      endpoint,
      scope: 'ecosystem-global',
      itemCount: compacted.itemCount,
      snapshotJson: compacted.snapshotJson,
      truncated: compacted.truncated,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      endpoint,
      scope: 'ecosystem-global',
      error: safeText(error instanceof Error ? error.message : error),
    };
  }
}

export const mtFixItCommlinkContract = {
  scope: 'ecosystem-global' as const,
  windowMinutes: COMMLINK_WINDOW_MINUTES,
  itemLimit: COMMLINK_ITEM_LIMIT,
  maxSnapshotText: MAX_COMMLINK_SNAPSHOT_TEXT,
};
