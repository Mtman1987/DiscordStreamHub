import { getSpaceMountainIconUrl } from './runtime-config';

function athenaPayload(content: string) {
  const icon = String(getSpaceMountainIconUrl() || '').trim();
  return {
    embeds: [{
      author: { name: 'Athena', ...(icon ? { icon_url: icon } : {}) },
      description: String(content || '').slice(0, 3900),
      color: 0x66e2ff,
      footer: { text: 'SpaceMountain · MtFixIt' },
    }],
    allowed_mentions: { parse: [] },
  };
}

function token() {
  const value = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!value) throw new Error('DISCORD_BOT_TOKEN is not configured');
  return value;
}

export async function sendDiscordMtFixItMessage(channelId: string, content: string) {
  const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(athenaPayload(content)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Discord Athena reply failed: ${response.status} ${await response.text()}`);
  return response.json().catch(() => null);
}

export async function editDiscordMtFixItMessage(channelId: string, messageId: string, content: string) {
  const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(athenaPayload(content)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Discord Athena edit failed: ${response.status} ${await response.text()}`);
  return response.json().catch(() => null);
}

export async function deleteDiscordMtFixItMessage(channelId: string, messageId: string) {
  if (!channelId || !messageId) return false;
  const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${token()}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return Boolean(response && (response.ok || response.status === 404));
}
