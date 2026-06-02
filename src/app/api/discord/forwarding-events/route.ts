import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DISCORD_API = 'https://discord.com/api/v10';

type ForwardedMessageMapping = {
  forwardedMessageId: string;
  forwardedThreadId: string;
  originGuildId?: string;
  originChannelId?: string;
  originMessageId?: string;
  sourceServerId: string;
};

async function discordRequest(endpoint: string, options: RequestInit = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN not configured');
  const res = await fetch(`${DISCORD_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord API ${res.status}: ${err}`);
  }

  return res.status === 204 ? null : res.json();
}

function isAuthorized(request: NextRequest) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  return Boolean(botToken && request.headers.get('x-discord-bot-token') === botToken);
}

function normalizeMapping(data: any): ForwardedMessageMapping | null {
  if (!data?.forwardedMessageId || !data?.forwardedThreadId || !data?.sourceServerId) return null;
  return data as ForwardedMessageMapping;
}

async function getIndexMapping(indexId: string): Promise<ForwardedMessageMapping | null> {
  const doc = await db.collection('forwardedMessageIndex').doc(indexId).get();
  if (!doc.exists) return null;
  return normalizeMapping(doc.data() || {});
}

async function findOriginMappingInSourceServer(sourceServerId: string, originMessageId: string): Promise<ForwardedMessageMapping | null> {
  if (!sourceServerId || !originMessageId) return null;

  const snapshot = await db
    .collection('servers')
    .doc(sourceServerId)
    .collection('forwardedMessages')
    .where('originMessageId', '==', originMessageId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return normalizeMapping(snapshot.docs[0].data());
}

async function deleteMapping(mapping: ForwardedMessageMapping) {
  await db
    .collection('servers')
    .doc(mapping.sourceServerId)
    .collection('forwardedMessages')
    .doc(mapping.forwardedMessageId)
    .delete();

  await db.collection('forwardedMessageIndex').doc(`forwarded_${mapping.forwardedMessageId}`).delete();
  if (mapping.originMessageId) {
    await db.collection('forwardedMessageIndex').doc(`origin_${mapping.originMessageId}`).delete();
  }
}

async function markOriginalDeleted(mapping: ForwardedMessageMapping) {
  const forwarded = await discordRequest(
    `/channels/${mapping.forwardedThreadId}/messages/${mapping.forwardedMessageId}`,
  );
  const embed = forwarded?.embeds?.[0];
  if (!embed) return;

  const fields = Array.isArray(embed.fields) ? embed.fields : [];
  const statusField = {
    name: 'Original status',
    value: '🗑️ Original message was deleted in the source server.',
    inline: false,
  };

  await discordRequest(`/channels/${mapping.forwardedThreadId}/messages/${mapping.forwardedMessageId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      embeds: [{
        ...embed,
        color: 0x747f8d,
        fields: [statusField, ...fields.filter((field: any) => field?.name !== statusField.name)],
      }],
      allowed_mentions: { parse: [] },
    }),
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const type = String(body.type || '');
    const messageId = String(body.messageId || '').trim();
    const guildId = String(body.guildId || '').trim();

    if (type !== 'message_delete' || !messageId) {
      return NextResponse.json({ error: 'message_delete type and messageId required' }, { status: 400 });
    }

    const forwardedMapping = await getIndexMapping(`forwarded_${messageId}`);
    if (forwardedMapping) {
      await deleteMapping(forwardedMapping);
      return NextResponse.json({ success: true, action: 'forwarded-mapping-deleted' });
    }

    const originMapping = await getIndexMapping(`origin_${messageId}`)
      || await findOriginMappingInSourceServer(guildId, messageId);
    if (originMapping) {
      try {
        await markOriginalDeleted(originMapping);
      } catch (error) {
        console.warn('[ForwardingEvents] Could not mark forwarded embed after origin delete:', error);
      }
      await deleteMapping(originMapping);
      return NextResponse.json({ success: true, action: 'origin-mapping-deleted-and-forwarded-marked' });
    }

    return NextResponse.json({ success: true, skipped: 'not-forwarded-message' });
  } catch (error) {
    console.error('[ForwardingEvents] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
