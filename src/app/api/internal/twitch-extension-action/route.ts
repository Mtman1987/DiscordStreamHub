import { NextRequest, NextResponse } from 'next/server';
import { sendOwnerDiscordDm } from '@/lib/owner-dm-service';
import { sendDiscordMessage } from '@/lib/discord-bot-service';

export const dynamic = 'force-dynamic';

type ViewerActionType = 'help' | 'join_request' | 'media_request';

function authorized(request: NextRequest) {
  const expected = String(process.env.SPMT_API_KEY || process.env.SPMT_PLATFORM_API_KEY || '').trim();
  const provided = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return Boolean(expected && provided && provided === expected);
}

function clean(value: unknown, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function actionTitle(type: ViewerActionType) {
  if (type === 'help') return 'Viewer needs help';
  if (type === 'join_request') return 'Viewer wants to join SpaceMountain';
  return 'Viewer media request';
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const type = clean(body?.type, 40) as ViewerActionType;
  if (!['help', 'join_request', 'media_request'].includes(type)) {
    return NextResponse.json({ error: 'Unsupported viewer action' }, { status: 400 });
  }

  const viewerId = clean(body?.viewerId, 160) || 'anonymous-extension-viewer';
  const message = clean(body?.message, 600);
  const featuredLogin = clean(body?.featuredLogin, 80);
  const channelId = clean(body?.channelId, 80);

  if (type === 'media_request' && !message) {
    return NextResponse.json({ error: 'Media request text is required' }, { status: 400 });
  }

  const title = actionTitle(type);
  const fields = [
    { name: 'Viewer', value: `\`${viewerId}\``, inline: true },
    ...(channelId ? [{ name: 'Twitch channel', value: `\`${channelId}\``, inline: true }] : []),
    ...(featuredLogin ? [{ name: 'Featured streamer', value: featuredLogin, inline: true }] : []),
    ...(message ? [{ name: type === 'media_request' ? 'Request' : 'Message', value: message, inline: false }] : []),
  ];

  const delivered = await sendOwnerDiscordDm({
    message: `${title} from Twitch Extension viewer ${viewerId}`,
    embed: {
      title,
      description: type === 'help'
        ? 'A viewer used the SpaceMountain Twitch overlay help control.'
        : type === 'join_request'
          ? 'A viewer used the SpaceMountain Twitch overlay join control.'
          : 'A viewer submitted a media request from the SpaceMountain Twitch overlay.',
      fields,
      footer: 'SpaceMountain Twitch Extension',
    },
  });

  const modChannelId = String(process.env.TWITCH_EXTENSION_MOD_CHANNEL_ID || '').trim();
  let modDelivered = false;
  if (modChannelId) {
    try {
      await sendDiscordMessage(modChannelId, {
        embeds: [{
          title,
          description: message || 'No additional text.',
          color: type === 'help' ? 0xed4245 : type === 'join_request' ? 0x57f287 : 0x5865f2,
          fields: fields.slice(0, 25),
          footer: { text: 'SpaceMountain Twitch Extension' },
          timestamp: new Date().toISOString(),
        }],
      });
      modDelivered = true;
    } catch (error) {
      console.warn('[twitch-extension] mod-channel delivery failed:', error);
    }
  }

  return NextResponse.json({
    success: true,
    ownerDm: delivered,
    modChannel: modDelivered,
  });
}
