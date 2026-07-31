export type RuntimeSecretName =
  | 'BOT_SECRET_KEY'
  | 'CHAT_TAG_BOT_SECRET'
  | 'CLIP_WORKER_SECRET'
  | 'DSH_POINTS_TOKEN'
  | 'DSH_SERVICE_SECRET'
  | 'SPACEMOUNTAIN_SHOUTOUT_TOKEN'
  | 'SPACEMOUNTAIN_FORUM_FORWARD_TOKEN'
  | 'STREAMWEAVER_SECRET'
  | 'DSH_CLIENT_SECRET';

function readSecret(name: RuntimeSecretName): string {
  return String(process.env[name] || '').trim();
}

function readFirstSecret(names: RuntimeSecretName[]): string {
  for (const name of names) {
    const value = readSecret(name);
    if (value) return value;
  }
  return '';
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function getBotServiceSecret(): string {
  return readFirstSecret(['BOT_SECRET_KEY', 'DSH_CLIENT_SECRET', 'DSH_SERVICE_SECRET']);
}

export function getChatTagServiceSecret(): string {
  return readFirstSecret(['CHAT_TAG_BOT_SECRET', 'BOT_SECRET_KEY', 'DSH_CLIENT_SECRET', 'DSH_SERVICE_SECRET']);
}

export function getClipWorkerSecret(): string {
  return readSecret('CLIP_WORKER_SECRET');
}

// StreamWeaver and DiscordStreamHub use one shared service credential.
// Legacy point/client secret names are intentionally not accepted here so
// configuration mistakes fail clearly instead of silently selecting another key.
export function getDshPointsSecret(): string {
  return readSecret('DSH_SERVICE_SECRET');
}

export function getDshClientSecret(): string {
  return readSecret('DSH_SERVICE_SECRET');
}

export function getServiceToServiceSecrets(): string[] {
  return uniqueNonEmpty([
    getBotServiceSecret(),
    getDshClientSecret(),
    getChatTagServiceSecret(),
    getDshPointsSecret(),
  ]);
}

export function hasAuthorizedBearerToken(authHeader: string | null, allowedSecrets: string[]): boolean {
  const rawHeader = String(authHeader || '').trim();
  if (!rawHeader.toLowerCase().startsWith('bearer ')) return false;
  const token = rawHeader.slice(7).trim();
  if (!token) return false;
  return uniqueNonEmpty(allowedSecrets).includes(token);
}

export function missingProductionServiceSecrets(): RuntimeSecretName[] {
  if (process.env.NODE_ENV !== 'production') return [];

  const missing: RuntimeSecretName[] = [];
  if (!getBotServiceSecret()) missing.push('BOT_SECRET_KEY');
  if (!getChatTagServiceSecret()) missing.push('CHAT_TAG_BOT_SECRET');
  if (!getClipWorkerSecret()) missing.push('CLIP_WORKER_SECRET');
  if (!getDshPointsSecret()) missing.push('DSH_SERVICE_SECRET');
  if (!getDshClientSecret()) missing.push('DSH_SERVICE_SECRET');
  if (!readSecret('SPACEMOUNTAIN_SHOUTOUT_TOKEN')) missing.push('SPACEMOUNTAIN_SHOUTOUT_TOKEN');
  if (!readSecret('SPACEMOUNTAIN_FORUM_FORWARD_TOKEN')) missing.push('SPACEMOUNTAIN_FORUM_FORWARD_TOKEN');
  if (!readSecret('STREAMWEAVER_SECRET')) missing.push('STREAMWEAVER_SECRET');
  return Array.from(new Set(missing));
}
