import { db } from './db';
import { signalDropExpired } from './signal-hunt';

let cleanupTimer: ReturnType<typeof setInterval> | undefined;
let cleaning = false;

export async function expireSignalDrop(dropId: string): Promise<void> {
  const ref = db.collection('signalDrops').doc(dropId);
  const doc = await ref.get();
  const drop = doc.data();
  if (!drop || drop.status === 'expired' || !signalDropExpired(drop.expiresAt)) return;
  const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) return;
  const request = async (channelId: string, messageId: string, body?: unknown) => {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
      method: body ? 'PATCH' : 'DELETE',
      headers: { Authorization: `Bot ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 404) throw new Error(`Signal expiry failed (${response.status})`);
  };
  await request(drop.channelId, drop.messageId);
  if (drop.alertChannelId && drop.alertMessageId) {
    await request(drop.alertChannelId, drop.alertMessageId, {
      embeds: [{ title: '📡 SIGNAL ENDED', description: 'This one-hour hunt window has ended. The next Signal will have a fresh location and a new alert.', color: 0x64748b }],
      components: [],
      allowed_mentions: { parse: [] },
    });
  }
  await ref.set({ status: 'expired', expiredAt: new Date().toISOString() }, { merge: true });
}

export function startSignalDropCleanup(): void {
  if (cleanupTimer) return;
  const sweep = async () => {
    if (cleaning) return;
    cleaning = true;
    try {
      const drops = await db.collection('signalDrops').where('status', '==', 'active').get();
      for (const doc of drops.docs) {
        if (signalDropExpired(doc.data()?.expiresAt)) {
          await expireSignalDrop(doc.id).catch((error) => console.warn('[SignalDrop] Expiry will retry:', error));
        }
      }
    } finally { cleaning = false; }
  };
  const run = () => void sweep().catch((error) => console.warn('[SignalDrop] Cleanup unavailable:', error));
  run();
  cleanupTimer = setInterval(run, 60_000);
  cleanupTimer.unref?.();
}
