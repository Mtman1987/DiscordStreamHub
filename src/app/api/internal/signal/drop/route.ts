import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';
import { ensureSignalSeekerRole } from '@/lib/signal-seeker-service';

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
  const signalSeekerRoleId = await ensureSignalSeekerRole(guildId).catch((error) => {
    console.error('[SignalDrop] Unable to resolve Signal Seeker role:', error);
    return '';
  });
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(signalSeekerRoleId ? { content: `<@&${signalSeekerRoleId}> a new Signal has appeared.` } : {}),
      embeds: [{
        author: { name: botName, ...(avatarUrl ? { icon_url: avatarUrl } : {}) },
        title: '📡 UNIDENTIFIED SIGNAL',
        description: clue,
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
    createdAt: new Date().toISOString(), claims: 0,
  });
  return NextResponse.json({ ok: true, dropId, messageId: String(message.id) });
}
