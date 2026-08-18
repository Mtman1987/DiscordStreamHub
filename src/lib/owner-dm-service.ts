import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_REQUEST_TIMEOUT_MS = 8_000;
const DISCORD_TRANSIENT_RETRIES = 2;
export const OWNER_DM_MAX_MESSAGE_LENGTH = 1900;
export const OWNER_DM_MAX_FILE_BYTES = 500_000;

type OwnerDmButton = {
  label: string;
  customId: string;
  style?: 1 | 2 | 3 | 4;
};

export class OwnerDmDeliveryError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'OwnerDmDeliveryError';
  }
}

export function getMtmanDiscordId(): string {
  return String(
    process.env.MTFIXIT_MTMAN_DISCORD_ID
      || process.env.HARDCODED_ADMIN_DISCORD_ID
      || process.env.NEXT_PUBLIC_HARDCODED_ADMIN_DISCORD_ID
      || getHardcodedAdminDiscordId()
      || '',
  ).trim();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientDiscordStatus(status: number) {
  return status === 429 || status >= 500;
}

function retryDelayMs(response: Response | null, attempt: number) {
  const retryAfterSeconds = Number(response?.headers.get('retry-after') || '');
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(2_000, Math.max(200, Math.round(retryAfterSeconds * 1000)));
  }
  return 350 * (attempt + 1);
}

async function discordFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= DISCORD_TRANSIENT_RETRIES; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS) });
      if (!isTransientDiscordStatus(response.status) || attempt === DISCORD_TRANSIENT_RETRIES) return response;
      await response.arrayBuffer().catch(() => undefined);
      console.warn(`[mtman-dm] ${label} transient status=${response.status} retry=${attempt + 1}/${DISCORD_TRANSIENT_RETRIES}`);
    } catch (error) {
      lastError = error;
      if (attempt === DISCORD_TRANSIENT_RETRIES) break;
      console.warn(`[mtman-dm] ${label} transient network failure retry=${attempt + 1}/${DISCORD_TRANSIENT_RETRIES}`);
    }
    await delay(retryDelayMs(response, attempt));
  }
  throw new OwnerDmDeliveryError(
    `Discord ${label} request failed after retries${lastError instanceof Error ? `: ${lastError.message}` : '.'}`,
    502,
  );
}

function dshPublicBaseUrl() {
  return String(
    process.env.DSH_PUBLIC_BASE_URL
      || process.env.NEXT_PUBLIC_APP_URL
      || process.env.NEXT_PUBLIC_BASE_URL
      || 'https://discord-stream-hub-new.fly.dev',
  ).trim().replace(/\/$/, '');
}

function approvalUrl(customId: string) {
  const match = customId.match(/^mtfixit_(approve|deny):([a-zA-Z0-9_-]{8,100})$/);
  if (!match) return '';
  const action = match[1] === 'approve' ? 'approve' : 'deny';
  const jobId = match[2];
  return `${dshPublicBaseUrl()}/api/mtfixit/decision?jobId=${encodeURIComponent(jobId)}&action=${action}`;
}

function buttonComponents(buttons: OwnerDmButton[] | undefined) {
  const safe = (buttons || []).slice(0, 5).filter((button) => button.label && /^mtfixit_(?:approve|deny):[a-zA-Z0-9_-]{8,100}$/.test(button.customId));
  if (!safe.length) return undefined;
  return [{
    type: 1,
    components: safe.map((button) => ({
      type: 2,
      style: 5,
      label: String(button.label).slice(0, 80),
      url: approvalUrl(button.customId),
    })),
  }];
}

function reportValue(fileContent: string, label: string) {
  const line = fileContent.split(/\r?\n/).find((entry) => entry.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  return line ? line.slice(line.indexOf(':') + 1).trim() : '';
}

function approvalEmbed(message: string, fileContent: string, buttons: OwnerDmButton[] | undefined) {
  if (!(buttons || []).some((button) => /^mtfixit_(?:approve|deny):/.test(button.customId))) return undefined;
  const job = reportValue(fileContent, 'Athena repair job') || 'unknown';
  const repo = reportValue(fileContent, 'Repository') || 'inferred by Athena';
  const resolution = reportValue(fileContent, 'Resolution') || 'awaiting approval';
  const pr = reportValue(fileContent, 'PR') || 'not published yet';
  const changedBlock = fileContent.match(/Changed files:\s*\n([\s\S]*?)\n\s*Checks:/i)?.[1]?.trim() || 'None';
  const checksBlock = fileContent.match(/Checks:\s*\n([\s\S]*?)(?:\n\s*PR:|$)/i)?.[1]?.trim() || 'No checks recorded';
  const passCount = (checksBlock.match(/^PASS\b/gm) || []).length;
  const failCount = (checksBlock.match(/^FAIL\b/gm) || []).length;
  const color = failCount > 0 ? 0xed4245 : 0x57f287;
  return [{
    author: { name: 'Athena · Repair Gate' },
    title: 'Approval required',
    description: String(message || 'Athena has a validated repair waiting for owner review.').slice(0, 3500),
    color,
    fields: [
      { name: 'Job', value: `\`${job}\``, inline: true },
      { name: 'Repository', value: repo.slice(0, 1024), inline: true },
      { name: 'State', value: resolution.slice(0, 1024), inline: true },
      { name: 'Changed files', value: `\`\`\`\n${changedBlock.slice(0, 900)}\n\`\`\``, inline: false },
      { name: 'Validation', value: `PASS ${passCount} · FAIL ${failCount}\n${checksBlock.slice(0, 850)}`, inline: false },
      { name: 'Pull request', value: pr.slice(0, 1024), inline: false },
    ],
    footer: { text: 'Review the attached repair report, then approve or deny below.' },
    timestamp: new Date().toISOString(),
  }];
}

export async function sendOwnerDiscordDm(input: {
  message?: string;
  fileName?: string;
  fileContent?: string;
  buttons?: OwnerDmButton[];
}): Promise<{ channelId: string; messageId: string }> {
  const ownerId = getMtmanDiscordId();
  const message = String(input.message || '').trim().slice(0, OWNER_DM_MAX_MESSAGE_LENGTH);
  const fileName = String(input.fileName || 'athena-support.txt').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const fileContent = String(input.fileContent || '');
  const components = buttonComponents(input.buttons);
  const embeds = approvalEmbed(message, fileContent, input.buttons);

  if (!ownerId) throw new OwnerDmDeliveryError('Mtman Discord ID is not configured.', 503);
  if (!message && !fileContent) throw new OwnerDmDeliveryError('Message or file content is required.', 400);
  if (Buffer.byteLength(fileContent, 'utf8') > OWNER_DM_MAX_FILE_BYTES) {
    throw new OwnerDmDeliveryError('Attachment is too large.', 413);
  }

  const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!botToken) throw new OwnerDmDeliveryError('Discord bot token is not configured.', 503);

  const dmResponse = await discordFetch(`${DISCORD_API_BASE}/users/@me/channels`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: ownerId }),
  }, 'open');
  if (!dmResponse.ok) {
    const detail = await dmResponse.text().catch(() => '');
    console.error(`[mtman-dm] open failed status=${dmResponse.status} detail=${detail.slice(0, 300)}`);
    throw new OwnerDmDeliveryError('Could not open the mtman DM.', 502);
  }

  const dm = await dmResponse.json() as { id?: string };
  const channelId = String(dm.id || '').trim();
  if (!channelId) throw new OwnerDmDeliveryError('Discord did not return an mtman DM channel.', 502);

  const discordPayload = {
    content: embeds ? '' : message,
    allowed_mentions: { parse: [] as string[] },
    ...(embeds ? { embeds } : {}),
    ...(components ? { components } : {}),
  };

  let sent: Response;
  if (fileContent) {
    const form = new FormData();
    form.append('files[0]', new Blob([fileContent], { type: 'text/plain' }), fileName);
    form.append('payload_json', JSON.stringify(discordPayload));
    sent = await discordFetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}` },
      body: form,
    }, 'send');
  } else {
    sent = await discordFetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload),
    }, 'send');
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
