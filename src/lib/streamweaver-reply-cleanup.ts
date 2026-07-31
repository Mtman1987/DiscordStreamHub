import 'server-only';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

type PendingReplyCleanup = {
  id: string;
  channelId: string;
  messageIds: string[];
  deleteAt: string;
};

const CLEANUP_FILE = 'streamweaver-discord-reply-cleanup.json';
const DEFAULT_DELETE_DELAY_MS = 10 * 60 * 1000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let processing = false;

function dataDir(): string {
  return process.env.DATA_DIR || process.env.FLY_VOLUME_PATH || join(process.cwd(), 'data');
}

function cleanupPath(): string {
  return join(dataDir(), CLEANUP_FILE);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

async function readQueue(): Promise<PendingReplyCleanup[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(cleanupPath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingReplyCleanup[]): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(cleanupPath(), JSON.stringify(queue.slice(-250), null, 2));
}

async function deleteDiscordMessage(channelId: string, messageId: string): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return false;
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${token}` },
  }).catch(() => null);
  return Boolean(response?.ok || response?.status === 404);
}

function schedule(entry: PendingReplyCleanup): void {
  const existing = timers.get(entry.id);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, Date.parse(entry.deleteAt) - Date.now());
  timers.set(entry.id, setTimeout(() => {
    timers.delete(entry.id);
    processDueStreamWeaverReplyCleanups().catch((error) => {
      console.warn('[StreamWeaver Reply Cleanup] Sweep failed:', error);
    });
  }, delay));
}

export async function recordStreamWeaverReplyCleanup(input: {
  channelId: string;
  sourceMessageId?: string;
  replyMessageIds: string[];
}): Promise<void> {
  const messageIds = unique([input.sourceMessageId || '', ...input.replyMessageIds]);
  if (!input.channelId || messageIds.length === 0) return;

  const queue = await readQueue();
  const entry: PendingReplyCleanup = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    channelId: input.channelId,
    messageIds,
    deleteAt: new Date(Date.now() + DEFAULT_DELETE_DELAY_MS).toISOString(),
  };
  await writeQueue([...queue, entry]);
  schedule(entry);
}

export async function deleteStreamWeaverReplySourceNow(channelId: string, messageId?: string): Promise<boolean> {
  if (!channelId || !messageId) return false;
  return deleteDiscordMessage(channelId, messageId);
}

export async function processDueStreamWeaverReplyCleanups(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const queue = await readQueue();
    const now = Date.now();
    const due = queue.filter((entry) => Date.parse(entry.deleteAt) <= now);
    const pending = queue.filter((entry) => Date.parse(entry.deleteAt) > now);

    for (const entry of due) {
      const failed: string[] = [];
      for (const messageId of unique(entry.messageIds)) {
        if (!await deleteDiscordMessage(entry.channelId, messageId)) failed.push(messageId);
      }
      if (failed.length > 0) {
        pending.push({
          ...entry,
          messageIds: failed,
          deleteAt: new Date(Date.now() + 60_000).toISOString(),
        });
      }
    }

    await writeQueue(pending);
    for (const entry of pending) schedule(entry);
  } finally {
    processing = false;
  }
}
