import { db } from '@/lib/db';
import { getAppUrl } from '@/lib/runtime-config';

const COLLECTION = 'cardPackRenderJobs';

export type CardPackRenderStatus = 'pending' | 'rendering' | 'ready' | 'failed';

export type CardPackRenderJob = {
  id: string;
  eventId: string;
  source: string;
  renderUrl: string;
  status: CardPackRenderStatus;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  gifUrl?: string;
  error?: string;
};

function normalizeId(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeSource(value: unknown): string {
  return String(value || 'card-pack').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) || 'card-pack';
}

function normalizeRenderUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('renderUrl is required');
  const parsed = new URL(raw);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('renderUrl must be http(s)');
  return parsed.toString();
}

function publicGifUrl(fileName: string): string {
  return `${getAppUrl().replace(/\/$/, '')}/api/media/card-pack-reveals/${encodeURIComponent(fileName)}`;
}

export async function createCardPackRenderJob(input: {
  eventId: string;
  source?: string;
  renderUrl: string;
}): Promise<CardPackRenderJob> {
  const eventId = normalizeId(input.eventId);
  if (!eventId) throw new Error('eventId is required');
  const id = eventId;
  const ref = db.collection(COLLECTION).doc(id);
  const existing = await ref.get();
  if (existing.exists) return existing.data() as CardPackRenderJob;

  const now = new Date().toISOString();
  const job: CardPackRenderJob = {
    id,
    eventId,
    source: normalizeSource(input.source),
    renderUrl: normalizeRenderUrl(input.renderUrl),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    attempts: 0,
  };
  await ref.set(job);
  return job;
}

export async function getCardPackRenderJob(idValue: unknown): Promise<CardPackRenderJob | null> {
  const id = normalizeId(idValue);
  if (!id) return null;
  const snapshot = await db.collection(COLLECTION).doc(id).get();
  return snapshot.exists ? snapshot.data() as CardPackRenderJob : null;
}

export async function claimNextCardPackRenderJob(): Promise<CardPackRenderJob | null> {
  const snapshot = await db.collection(COLLECTION).get();
  const jobs = snapshot.docs
    .map((doc: any) => doc.data() as CardPackRenderJob)
    .filter((job: CardPackRenderJob) => job.status === 'pending')
    .sort((a: CardPackRenderJob, b: CardPackRenderJob) => a.createdAt.localeCompare(b.createdAt));
  const job = jobs[0];
  if (!job) return null;
  const updated: CardPackRenderJob = {
    ...job,
    status: 'rendering',
    attempts: Number(job.attempts || 0) + 1,
    updatedAt: new Date().toISOString(),
    error: '',
  };
  await db.collection(COLLECTION).doc(job.id).set(updated, { merge: true });
  return updated;
}

export async function completeCardPackRenderJob(idValue: unknown, fileName: string): Promise<CardPackRenderJob | null> {
  const job = await getCardPackRenderJob(idValue);
  if (!job) return null;
  const updated: CardPackRenderJob = {
    ...job,
    status: 'ready',
    gifUrl: publicGifUrl(fileName),
    updatedAt: new Date().toISOString(),
    error: '',
  };
  await db.collection(COLLECTION).doc(job.id).set(updated, { merge: true });
  return updated;
}

export async function failCardPackRenderJob(idValue: unknown, errorValue: unknown): Promise<CardPackRenderJob | null> {
  const job = await getCardPackRenderJob(idValue);
  if (!job) return null;
  const attempts = Number(job.attempts || 0);
  const updated: CardPackRenderJob = {
    ...job,
    status: attempts >= 3 ? 'failed' : 'pending',
    updatedAt: new Date().toISOString(),
    error: String(errorValue || 'render failed').slice(0, 500),
  };
  await db.collection(COLLECTION).doc(job.id).set(updated, { merge: true });
  return updated;
}
