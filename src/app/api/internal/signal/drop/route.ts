import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';
import { ensureSignalSeekerRole } from '@/lib/signal-seeker-service';
import { getChatTagChannelId, getHardcodedGuildId } from '@/lib/runtime-config';
import { SIGNAL_DROP_TTL_MS, SILENT_MESSAGE_FLAG, signalAlertPayload } from '@/lib/signal-hunt';
import { expireSignalDrop, startSignalDropCleanup } from '@/lib/signal-drop-cleanup';

export async function POST(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const input = await request.json().catch(() => ({}));
  const guildId = String(input.guildId || '').trim();
  const channelId = String(input.channelId || '').trim();
  const channelName = String(input.channelName || channelId).trim();
  const clue = String(input.clue || '').trim().slice(0, 1800);
  const botName = String(input.botName || 'StreamWeaver').trim().slice(0, 80);
  const avatarUrl = String(input.avatarUrl || '').trim();
  if (!guildId || !channelId || !clue) return NextResponse.json({ error: 'guildId, channelId, and clue are required' }, { status: 400 });
  const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!botToken) return NextResponse.json({ error: 'Discord bot token is unavailable' }, { status: 503 });
  const dropId = randomUUID();
  const huntConfig = await db.collection('servers').doc(guildId).collection('config').doc('signal-seeker').get();
  const alertChannelId = String(huntConfig.data()?.notificationChannelId
    || (guildId === getHardcodedGuildId() ? getChatTagChannelId() : '')).trim();
  // Validate the destination before creating the source, so a bad channel cannot
  // send a private/guild-specific hunt notice to another server.
  if (!alertChannelId) return NextResponse.json({ error: 'Signal notification channel is not configured' }, { status: 503 });
  const alertChannel = await fetch(`https://discord.com/api/v10/channels/${alertChannelId}`, {
    headers: { Authorization: `Bot ${botToken}` }, signal: AbortSignal.timeout(10_000),
  }).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (String(alertChannel?.guild_id || '') !== guildId) {
    return NextResponse.json({ error: 'Signal notification channel is unavailable in this server' }, { status: 503 });
  }
  const signalSeekerRoleId = await ensureSignalSeekerRole(guildId).catch((error) => {
    console.error('[SignalDrop] Unable to resolve Signal Seeker role:', error);
    return '';
  });
  const expiresAt = new Date(Date.now() + SIGNAL_DROP_TTL_MS).toISOString();
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      flags: SILENT_MESSAGE_FLAG,
      ...(signalSeekerRoleId ? { content: `<@&${signalSeekerRoleId}> a new Signal has appeared.` } : {}),
      embeds: [{
        author: { name: botName, ...(avatarUrl ? { icon_url: avatarUrl } : {}) },
        title: '📡 UNIDENTIFIED SIGNAL',
        description: `${clue}\n\nAvailable for one hour · ends <t:${Math.floor(Date.parse(expiresAt) / 1000)}:R>.\nYou can intercept this Signal repeatedly for clues to the other eggs.`,
        color: 0x5865f2,
        footer: { text: 'Signal anomaly • Discord identity verified on intercept' },
        timestamp: new Date().toISOString(),
      }],
      components: [{ type: 1, components: [{ type: 2, style: 1, label: 'INTERCEPT SIGNAL', custom_id: `signal_intercept:${dropId}`, emoji: { name: '📡' } }] }],
      allowed_mentions: { parse: [], roles: signalSeekerRoleId ? [signalSeekerRoleId] : [] },
    }),
  });
  const message = await response.json().catch(() => null);
  if (!response.ok || !message?.id) return NextResponse.json({ error: `Discord post failed (${response.status})` }, { status: 502 });
  await db.collection('signalDrops').doc(dropId).set({
    id: dropId, guildId, channelId, channelName, messageId: String(message.id), clue, botName,
    createdAt: new Date().toISOString(), expiresAt, claims: 0, status: 'active',
  });
  startSignalDropCleanup();
  const deletionTimer = setTimeout(() => {
    expireSignalDrop(dropId).catch((error) => {
      console.error('[SignalDrop] Timed deletion crashed:', error);
    });
  }, SIGNAL_DROP_TTL_MS);
  deletionTimer.unref?.();
  // A notice failure must not throw after the source was posted: the scheduler
  // would otherwise create another source drop on its next tick.
  if (signalSeekerRoleId) {
    try {
      const alert = await fetch(`https://discord.com/api/v10/channels/${alertChannelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(signalAlertPayload({ guildId, channelId, messageId: String(message.id), roleId: signalSeekerRoleId, expiresAt })),
        signal: AbortSignal.timeout(10_000),
      });
      const notice = await alert.json().catch(() => null);
      if (!alert.ok || !notice?.id) throw new Error(`Signal notification failed (${alert.status})`);
      await db.collection('signalDrops').doc(dropId).set({ alertChannelId, alertMessageId: String(notice.id) }, { merge: true });
    } catch (error) { console.error('[SignalDrop] Source is available, but the hunter alert failed:', error); }
  }
  return NextResponse.json({ ok: true, dropId, messageId: String(message.id), expiresAt });
}
