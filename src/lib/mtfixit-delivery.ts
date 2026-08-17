import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MtFixItPublicOutcome, MtFixItSource } from './mtfixit-contract';
import { sendOwnerDiscordDm } from './owner-dm-service';

const DEFAULT_ROTATOR_URL = 'https://mtman-machine-rotator.fly.dev';
const DELIVERY_POLL_MS = 10_000;
const activeResumes = new Set<string>();

export type MtFixItDeliveryRecord = {
  schemaVersion: 'dsh.mtfixit.delivery/v1';
  jobId: string;
  source: MtFixItSource;
  reporter: string;
  description: string;
  channelId: string;
  guildId?: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'final';
  lastOutcome?: MtFixItPublicOutcome;
};

function baseDir() { return join(String(process.env.MTFIXIT_DATA_DIR || '/data/mtfixit').trim(), 'deliveries'); }
function fileFor(jobId: string) { return join(baseDir(), `${jobId}.json`); }
function rotatorBase() { return String(process.env.ROTATOR_BASE_URL || process.env.CODEX_WORKER_URL || DEFAULT_ROTATOR_URL).trim().replace(/\/$/, ''); }
function sharedKey() { return String(process.env.SPMT_API_KEY || process.env.SPMT_PLATFORM_API_KEY || '').trim(); }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safe(value: unknown) { return String(value instanceof Error ? value.message : value || 'unknown').replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 900); }

async function save(record: MtFixItDeliveryRecord) {
  await mkdir(baseDir(), { recursive: true });
  record.updatedAt = new Date().toISOString();
  await writeFile(fileFor(record.jobId), JSON.stringify(record, null, 2), 'utf8');
}

export async function registerMtFixItDelivery(input: {
  jobId: string; source: MtFixItSource; reporter: string; description: string; channelId: string; guildId?: string;
}) {
  const now = new Date().toISOString();
  const record: MtFixItDeliveryRecord = {
    schemaVersion: 'dsh.mtfixit.delivery/v1', jobId: input.jobId, source: input.source, reporter: input.reporter,
    description: input.description, channelId: input.channelId, guildId: input.guildId, createdAt: now, updatedAt: now, status: 'active',
  };
  await save(record);
  return record;
}

export async function recordMtFixItOutcome(jobId: string, outcome: MtFixItPublicOutcome) {
  try {
    const record = JSON.parse(await readFile(fileFor(jobId), 'utf8')) as MtFixItDeliveryRecord;
    record.lastOutcome = outcome;
    if (['fixed', 'failed', 'no-change'].includes(outcome)) record.status = 'final';
    await save(record);
  } catch (error) {
    console.warn(`[MtFixItDelivery] Could not record outcome job=${jobId}:`, safe(error));
  }
}

export async function listPendingMtFixItDeliveries(source: MtFixItSource): Promise<MtFixItDeliveryRecord[]> {
  try {
    const names = (await readdir(baseDir())).filter((name) => name.endsWith('.json'));
    const records = await Promise.all(names.map(async (name) => {
      try { return JSON.parse(await readFile(join(baseDir(), name), 'utf8')) as MtFixItDeliveryRecord; } catch { return null; }
    }));
    return records.filter((record): record is MtFixItDeliveryRecord => Boolean(record && record.status === 'active' && record.source === source));
  } catch { return []; }
}

async function rotatorRequest(path: string, init: RequestInit = {}) {
  const key = sharedKey(); if (!key) throw new Error('MtFixIt shared key unavailable');
  const response = await fetch(`${rotatorBase()}${path}`, {
    ...init,
    headers: { accept: 'application/json', 'x-dsh-mtfixit-key': key, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
    cache: 'no-store', signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Rotator HTTP ${response.status}`);
  return payload;
}

async function currentOutcome(record: MtFixItDeliveryRecord): Promise<{ outcome?: MtFixItPublicOutcome; terminal?: boolean; resolution?: any }> {
  const job = await rotatorRequest(`/api/dsh/mtfixit/jobs/${encodeURIComponent(record.jobId)}`);
  if (job?.status === 'queued' || job?.status === 'running') return {};
  if (job?.status === 'failed') return { outcome: 'failed', terminal: true };
  let resolution: any;
  try { resolution = await rotatorRequest(`/api/dsh/mtfixit/jobs/${encodeURIComponent(record.jobId)}/resolution`); }
  catch { resolution = null; }
  if (!resolution || resolution.status === 'awaiting_analysis') {
    const result = await rotatorRequest(`/api/dsh/mtfixit/jobs/${encodeURIComponent(record.jobId)}/resolution`, { method: 'POST', body: JSON.stringify({ action: 'resolve' }) });
    resolution = result?.state;
  }
  if (resolution?.status === 'awaiting_approval') return { outcome: 'waiting-review', terminal: false, resolution };
  if (resolution?.status === 'deploying') return { resolution };
  if (resolution?.status === 'deployed') return { outcome: 'fixed', terminal: true, resolution };
  if (resolution?.status === 'no_change') return { outcome: 'no-change', terminal: true, resolution };
  if (resolution?.status === 'failed') return { outcome: 'failed', terminal: true, resolution };
  if (resolution?.status === 'denied') return { outcome: 'waiting-review', terminal: true, resolution };
  return { resolution };
}

async function notifyResumedOwner(record: MtFixItDeliveryRecord, outcome: MtFixItPublicOutcome, resolution: any) {
  if (outcome === 'waiting-review' && record.lastOutcome !== 'waiting-review' && resolution?.status === 'awaiting_approval') {
    await sendOwnerDiscordDm({
      message: `Athena resumed MtFixIt job **${record.jobId}** after a DSH restart and found a validated new fix for **${record.reporter}**: “${record.description.slice(0, 800)}”\n\nApprove to merge/deploy it, or deny to hold it.`,
      buttons: [
        { label: 'Approve & Deploy', customId: `mtfixit_approve:${record.jobId}`, style: 3 },
        { label: 'Deny / Hold', customId: `mtfixit_deny:${record.jobId}`, style: 4 },
      ],
    }).catch((error) => console.warn('[MtFixItDelivery] resumed approval DM failed:', safe(error)));
  }
  if (outcome === 'fixed') await sendOwnerDiscordDm({ message: `Resumed MtFixIt job **${record.jobId}** finished successfully after restart; deployment checks passed.` }).catch(() => undefined);
  if (outcome === 'failed') await sendOwnerDiscordDm({ message: `Resumed MtFixIt job **${record.jobId}** ended in failure after restart and needs mtman review.` }).catch(() => undefined);
}

export async function resumePendingMtFixItDeliveries(
  source: MtFixItSource,
  send: (record: MtFixItDeliveryRecord, outcome: MtFixItPublicOutcome) => Promise<void>,
) {
  const records = await listPendingMtFixItDeliveries(source);
  for (const record of records) {
    if (activeResumes.has(record.jobId)) continue;
    activeResumes.add(record.jobId);
    void (async () => {
      try {
        for (;;) {
          const state = await currentOutcome(record);
          if (state.outcome && state.outcome !== record.lastOutcome) {
            await notifyResumedOwner(record, state.outcome, state.resolution);
            await send(record, state.outcome);
            record.lastOutcome = state.outcome;
            if (state.terminal) record.status = 'final';
            await save(record);
          }
          if (state.terminal) return;
          await delay(DELIVERY_POLL_MS);
        }
      } catch (error) {
        console.warn(`[MtFixItDelivery] resume failed job=${record.jobId}:`, safe(error));
      } finally { activeResumes.delete(record.jobId); }
    })();
  }
  return records.length;
}
