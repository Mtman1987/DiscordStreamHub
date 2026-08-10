import { getStreamweaverUrl } from '@/lib/runtime-config';
import { getDshClientSecret } from '@/lib/runtime-secrets';

function timeoutSignal(milliseconds: number) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

export async function finalizePrivateDmDiscordMessage(
  channelId: string,
  messageId: string,
): Promise<boolean> {
  const normalizedChannelId = String(channelId || '').trim();
  const normalizedMessageId = String(messageId || '').trim();
  if (!/^\d{15,22}$/.test(normalizedChannelId) || !/^\d{15,22}$/.test(normalizedMessageId)) {
    return false;
  }

  const secret = getDshClientSecret();
  if (!secret) {
    console.warn('[Private DM Finalizer] Shared bot service secret is not configured.');
    return false;
  }

  try {
    const response = await fetch(
      `${getStreamweaverUrl().replace(/\/$/, '')}/api/private-chat/finalize-discord-message`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelId: normalizedChannelId,
          messageId: normalizedMessageId,
        }),
        signal: timeoutSignal(10_000),
      },
    );
    if (!response.ok) {
      console.warn('[Private DM Finalizer] StreamWeaver rejected the message:', response.status);
      return false;
    }
    const payload = await response.json().catch(() => null);
    return Boolean(payload?.success && payload?.finalized);
  } catch (error) {
    console.warn('[Private DM Finalizer] StreamWeaver request failed:', error);
    return false;
  }
}
