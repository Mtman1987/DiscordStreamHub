import { NextRequest, NextResponse } from 'next/server';
import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';

export const dynamic = 'force-dynamic';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const MAX_MESSAGE_LENGTH = 1900;
const MAX_FILE_BYTES = 500_000;

function authorized(request: NextRequest) {
  const expected = String(process.env.DSH_SERVICE_SECRET || '').trim();
  const provided = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return Boolean(expected && provided && provided === expected);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const ownerId = String(getHardcodedAdminDiscordId() || '').trim();
    const message = String(body?.message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    const fileName = String(body?.fileName || 'athena-support.txt').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const fileContent = String(body?.fileContent || '');

    if (!ownerId) return NextResponse.json({ error: 'Owner Discord ID is not configured.' }, { status: 503 });
    if (!message && !fileContent) return NextResponse.json({ error: 'Message or file content is required.' }, { status: 400 });
    if (Buffer.byteLength(fileContent, 'utf8') > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Attachment is too large.' }, { status: 413 });
    }

    const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
    if (!botToken) return NextResponse.json({ error: 'Discord bot token is not configured.' }, { status: 503 });

    const dmResponse = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: ownerId }),
    });
    if (!dmResponse.ok) {
      const detail = await dmResponse.text().catch(() => '');
      console.error(`[owner-dm] open failed status=${dmResponse.status} detail=${detail.slice(0, 300)}`);
      return NextResponse.json({ error: 'Could not open the owner DM.' }, { status: 502 });
    }

    const dm = await dmResponse.json() as { id?: string };
    const channelId = String(dm.id || '').trim();
    if (!channelId) return NextResponse.json({ error: 'Discord did not return a DM channel.' }, { status: 502 });

    let sent: Response;
    if (fileContent) {
      const form = new FormData();
      form.append('files[0]', new Blob([fileContent], { type: 'text/plain' }), fileName);
      if (message) form.append('payload_json', JSON.stringify({ content: message }));
      sent = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}` },
        body: form,
      });
    } else {
      sent = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message }),
      });
    }

    if (!sent.ok) {
      const detail = await sent.text().catch(() => '');
      console.error(`[owner-dm] send failed status=${sent.status} detail=${detail.slice(0, 300)}`);
      return NextResponse.json({ error: 'Discord rejected the owner DM.' }, { status: 502 });
    }

    const payload = await sent.json().catch(() => ({})) as { id?: string };
    console.log(`[owner-dm] delivered channel=${channelId} message=${String(payload.id || 'unknown')}`);
    return NextResponse.json({ success: true, channelId, messageId: String(payload.id || '') });
  } catch (error) {
    console.error('[owner-dm] internal failure:', error);
    return NextResponse.json({ error: 'Internal owner DM error.' }, { status: 500 });
  }
}
