import { getRuntimePublicUrl } from '@/lib/runtime-config';
import { getDshClientSecret } from '@/lib/runtime-secrets';

export async function forwardPokemonInteractionToStreamWeaver(body: any): Promise<Response> {
  const secret = getDshClientSecret();
  if (!secret) {
    throw new Error('DiscordStreamHub service credential is not configured.');
  }

  const baseUrl = getRuntimePublicUrl('streamweaverUrl').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/discord/pokemon-interaction`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...body,
      customId: body?.data?.custom_id,
      values: body?.data?.values,
      actorDiscordId: body?.member?.user?.id || body?.user?.id,
      actorName:
        body?.member?.user?.global_name
        || body?.member?.nick
        || body?.member?.user?.username
        || body?.user?.global_name
        || body?.user?.username,
      guildId: body?.guild_id,
      channelId: body?.channel_id,
      messageId: body?.message?.id,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`StreamWeaver interaction failed: ${response.status} ${detail}`.trim());
  }

  return response;
}
