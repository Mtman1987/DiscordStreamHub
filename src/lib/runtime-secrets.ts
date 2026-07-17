export type RuntimeSecretName =
  | 'BOT_SECRET_KEY'
  | 'CHAT_TAG_BOT_SECRET'
  | 'CLIP_WORKER_SECRET'
  | 'DSH_POINTS_TOKEN'
  | 'SPACEMOUNTAIN_SHOUTOUT_TOKEN'
  | 'SPACEMOUNTAIN_FORUM_FORWARD_TOKEN'
  | 'STREAMWEAVER_SECRET'
  | 'DSH_CLIENT_SECRET';

function readSecret(name: RuntimeSecretName): string {
  return String(process.env[name] || '').trim();
}

export function getBotServiceSecret(): string {
  return readSecret('BOT_SECRET_KEY');
}

export function getChatTagServiceSecret(): string {
  return readSecret('CHAT_TAG_BOT_SECRET');
}

export function getClipWorkerSecret(): string {
  return readSecret('CLIP_WORKER_SECRET');
}

export function getDshPointsSecret(): string {
  return readSecret('DSH_POINTS_TOKEN');
}

export function missingProductionServiceSecrets(): RuntimeSecretName[] {
  if (process.env.NODE_ENV !== 'production') return [];

  const missing: RuntimeSecretName[] = [];
  if (!getBotServiceSecret()) missing.push('BOT_SECRET_KEY');
  if (!getChatTagServiceSecret()) missing.push('CHAT_TAG_BOT_SECRET');
  if (!getClipWorkerSecret()) missing.push('CLIP_WORKER_SECRET');
  if (!getDshPointsSecret()) missing.push('DSH_POINTS_TOKEN');
  if (!readSecret('SPACEMOUNTAIN_SHOUTOUT_TOKEN')) missing.push('SPACEMOUNTAIN_SHOUTOUT_TOKEN');
  if (!readSecret('SPACEMOUNTAIN_FORUM_FORWARD_TOKEN')) missing.push('SPACEMOUNTAIN_FORUM_FORWARD_TOKEN');
  if (!readSecret('STREAMWEAVER_SECRET')) missing.push('STREAMWEAVER_SECRET');
  if (!readSecret('DSH_CLIENT_SECRET')) missing.push('DSH_CLIENT_SECRET');
  return missing;
}
