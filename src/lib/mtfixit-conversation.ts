import { db } from './db';

const COLLECTION = 'runtime/mtfixit-pending/users';
const TTL_MS = 10 * 60 * 1000;

export type PendingMtFixItConversation = {
  channelId: string;
  guildId: string;
  reporterId: string;
  reporter: string;
  promptMessageId: string;
  createdAt: string;
  expiresAt: string;
};

function key(channelId: string, reporterId: string) {
  return `${String(channelId || '').trim()}_${String(reporterId || '').trim()}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function beginPendingMtFixItConversation(input: Omit<PendingMtFixItConversation, 'createdAt' | 'expiresAt'>) {
  const now = Date.now();
  const record: PendingMtFixItConversation = {
    ...input,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
  };
  db.set(COLLECTION, key(input.channelId, input.reporterId), record);
  return record;
}

export async function getPendingMtFixItConversation(channelId: string, reporterId: string): Promise<PendingMtFixItConversation | null> {
  const id = key(channelId, reporterId);
  const record = db.get(COLLECTION, id) as PendingMtFixItConversation | null;
  if (!record) return null;
  if (Date.parse(record.expiresAt) <= Date.now()) {
    db.delete(COLLECTION, id);
    return null;
  }
  return record;
}

export async function consumePendingMtFixItConversation(channelId: string, reporterId: string): Promise<PendingMtFixItConversation | null> {
  const record = await getPendingMtFixItConversation(channelId, reporterId);
  if (record) db.delete(COLLECTION, key(channelId, reporterId));
  return record;
}

export async function cancelPendingMtFixItConversation(channelId: string, reporterId: string) {
  db.delete(COLLECTION, key(channelId, reporterId));
}
