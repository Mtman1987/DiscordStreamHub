import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
export const OWNER_DM_MAX_MESSAGE_LENGTH = 1900;
export const OWNER_DM_MAX_FILE_BYTES = 500_000;

export class OwnerDmDeliveryError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'OwnerDmDeliveryError';
  }
}

function getMtmanDiscordId(): string {
  // Privileged server-side delivery must be able to use a production Fly secret.
  // runtime-config intentionally ignores env overrides in production, which can
  // leave a stale persisted public ID in control of private support delivery.
  return String(
    process.env.MTFIXIT_MTMAN_DISCORD_ID
      || process.env.HARDCODED_ADMIN_DISCORD_ID
      || process.env.NEXT_PUBLIC_HARDCODED_ADMIN_DISCORD_ID
      || getHardcodedAdminDiscordId()
      || '',
  ).trim();
}

export async function sendOwnerDiscordDm(input: {
  message?: string;
  fileName?: string;
  fileContent?: string;
}): Promise<{ channelId: string; messageId: string }> {
  const ownerId = getMtmanDiscordId();
  const message = String(input.message || '').trim().slice(0, OWNER_DM_MAX_MESSAGE_LENGTH);
  const fileName = String(input.fileName || 'athena-support.txt').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const fileContent = String(input.fileContent || '');

  if (!ownerId) throw new OwnerDmDeliveryError('Mtman Discord ID is not configured.', 503);
  if (!message && !fileContent) throw new OwnerDmDeliveryError('Message or file content is required.', 400);
  if (Buffer.byteLength(fileContent, 'utf8') > OWNER_DM_MAX_FILE_BYTES) {
    throw new OwnerDmDeliveryError('Attachment is too large.', 413);
  }

  const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!botToken) throw new OwnerDmDeliveryError('Discord bot token is not configured.', 503);

  const dmResponse = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: ownerId }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!dmResponse.ok) {
    const detail = await dmResponse.text().catch(() => '');
    console.error(`[mtman-dm] open failed status=${dmResponse.status} detail=${detail.slice(0, 300)}`);
    throw new OwnerDmDeliveryError('Could not open the mtman DM.', 502);
  }

  const dm = await dmResponse.json() as { id?: string };
  const channelId = String(dm.id || '').trim();
  if (!channelId) throw new OwnerDmDeliveryError('Discord did not return an mtman DM channel.', 502);

  let sent: Response;
  if (fileContent) {
    const form = new FormData();
    form.append('files[0]', new Blob([fileContent], { type: 'text/plain' }), fileName);
    if (message) form.append('payload_json', JSON.stringify({ content: message, allowed_mentions: { parse: [] } }));
    sent = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}` },
      body: form,
      signal: AbortSignal.timeout(8_000),
    });
  } else {
    sent = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(8_000),
    });
  }

  if (!sent.ok) {
    const detail = await sent.text().catch(() => '');
    console.error(`[mtman-dm] send failed status=${sent.status} detail=${detail.slice(0, 300)}`);
    throw new OwnerDmDeliveryError('Discord rejected the mtman DM.', 502);
  }

  const payload = await sent.json().catch(() => ({})) as { id?: string };
  const messageId = String(payload.id || '');
  console.log(`[mtman-dm] delivered channel=${channelId} message=${messageId || 'unknown'}`);
  return { channelId, messageId };
}
