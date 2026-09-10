import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { SPMT_BASE_URL } from '@/lib/spmt-session';
import { clearSpmtServiceTokenCache, getSpmtServiceToken } from '@/lib/spmt-service-token';
import { applyVoidwalkerRole } from './voidwalker-role';

type RewardJob = { userId: string; discordUserId: string; claimToken: string; title: string };
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;
let deliveredCount = 0;
let lastBatchClaimed = 0;

async function spmt(path: string, body: unknown) {
  const token = await getSpmtServiceToken(['identity:write']);
  const response = await fetch(`${SPMT_BASE_URL}/api/internal/easter-eggs/discord-rewards/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) clearSpmtServiceTokenCache();
  if (!response.ok) throw new Error(`SPMT Discord reward ${path} failed (${response.status})`);
  return response.json();
}

async function discord(path: string, init: RequestInit = {}) {
  const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) throw new Error('Discord bot token is unavailable');
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    ...init, headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json',
      'X-Audit-Log-Reason': 'Earned%20Voidwalker%20Easter%20egg%20title' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Discord role update failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}

export async function syncVoidwalkerRewards() {
  if (running) return;
  running = true;
  try {
    const { jobs } = await spmt('claim', { limit: 5 }) as { jobs: RewardJob[] };
    lastBatchClaimed = jobs.length;
    let batchError: string | null = null;
    for (const job of jobs) {
      try {
        if (job.title !== 'Voidwalker') throw new Error('Unexpected title in the SPMT reward queue');
        const guildId = getHardcodedGuildId();
        const config = db.collection('servers').doc(guildId).collection('config');
        const [clue, title] = await Promise.all([config.doc('signal-seeker').get(), config.doc('voidwalker').get()]);
        await applyVoidwalkerRole({ guildId, discordUserId: job.discordUserId, discord,
          clueRoleId: String(clue.data()?.roleId || ''), configuredTitleRoleId: String(title.data()?.roleId || ''),
          rememberTitleRole: async (roleId) => { await config.doc('voidwalker').set({ roleId, roleName: 'Voidwalker', updatedAt: new Date().toISOString() }, { merge: true }); },
        });
        await spmt('ack', { ...job, delivered: true });
        deliveredCount += 1;
      } catch (error) {
        batchError = error instanceof Error ? error.message : 'Discord reward sync failed';
        // If acknowledgement itself fails, the SPMT lease expires and the
        // complete job is redelivered. Never report success before both roles.
        await spmt('ack', { ...job, delivered: false, error: batchError }).catch(() => {});
      }
    }
    lastSuccessAt = new Date().toISOString();
    if (batchError || jobs.length) lastError = batchError;
    if (batchError) console.warn('[VoidwalkerRoles]', batchError);
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Discord reward worker unavailable';
    console.warn('[VoidwalkerRoles]', lastError);
  } finally {
    running = false;
  }
}

export function startVoidwalkerRewardWorker() {
  if (timer) return;
  void syncVoidwalkerRewards();
  timer = setInterval(() => { void syncVoidwalkerRewards(); }, 30_000);
  timer.unref?.();
}

export function voidwalkerRewardWorkerStatus() {
  return { started: Boolean(timer), running, lastSuccessAt, lastError, deliveredCount, lastBatchClaimed };
}
