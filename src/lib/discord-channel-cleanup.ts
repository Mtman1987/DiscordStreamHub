import { sqliteService } from './sqlite-service';
import { channelPermissions } from './discord-guild-access';
import { guildAccess } from './discord-server-permissions';
import { forumDiscordRequest, type DiscordRequest } from './discord-forum-mirror';

export type NukeMode = 'bot' | 'all' | 'until';
export type CleanupJob = {
  id: string; ownerAccountId: string; discordUserId: string; guildId: string; channelId: string; channelName: string;
  mode: NukeMode; untilMessageId: string; botId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  before: string; pages: number; deleted: number; failed: number; reachedTarget: boolean;
  pendingIds: string[]; pageDone: boolean; log: string[]; retryAt?: number; retryCount?: number; error?: string; updatedAt: string; createdAt: string;
};
const path = (id: string) => 'discordCleanupJobs/' + id;
export const cleanupJob = (id: string): CleanupJob | null => sqliteService.getDoc(path(id)).data || null;
export function cleanupJobs(): CleanupJob[] { return sqliteService.getCollection('discordCleanupJobs').docs; }
function persist(job: CleanupJob) {
  job.updatedAt = new Date().toISOString();
  job.log = job.log.slice(-80);
  sqliteService.setDoc(path(job.id), job);
}
export function enqueueCleanup(input: Pick<CleanupJob, 'ownerAccountId' | 'discordUserId' | 'guildId' | 'channelId' | 'channelName' | 'mode' | 'untilMessageId' | 'botId'>) {
  const lease = 'nuke-channel:' + input.channelId, owner = crypto.randomUUID();
  if (!sqliteService.claimLease(lease, owner)) throw new Error('Channel cleanup is being scheduled. Retry shortly.');
  try {
    const existing = cleanupJobs().find(job => job.channelId === input.channelId && ['queued', 'running'].includes(job.status));
    if (existing) {
      if (existing.ownerAccountId !== input.ownerAccountId || existing.mode !== input.mode || existing.untilMessageId !== input.untilMessageId) throw new Error('This channel already has an active cleanup job.');
      return existing;
    }
    const now = new Date().toISOString();
    // Freeze the upper boundary so newly arriving messages are not accidentally nuked.
    const before = ((BigInt(Date.now() - 1420070400000) << BigInt(22)) + BigInt(4194303)).toString();
    const job: CleanupJob = { ...input, id: crypto.randomUUID(), status: 'queued', before, pages: 0, deleted: 0, failed: 0,
      reachedTarget: input.mode !== 'until', pendingIds: [], pageDone: false, log: ['Cleanup queued for #' + input.channelName], createdAt: now, updatedAt: now };
    persist(job); return job;
  } finally { sqliteService.releaseLease(lease, owner); }
}
function bulkEligible(id: string) {
  const created = Number(BigInt(id) >> BigInt(22)) + 1420070400000;
  return Date.now() - created < 13.8 * 86400000;
}
async function validateJobAuthority(job: CleanupJob, api: DiscordRequest) {
  const [guild, member, channel] = await Promise.all([
    api('/guilds/' + job.guildId), api('/guilds/' + job.guildId + '/members/' + job.discordUserId), api('/channels/' + job.channelId),
  ]);
  if (channel.guild_id !== job.guildId) throw new Error('Cleanup channel is outside the authorized server');
  const parent = [10, 11, 12].includes(Number(channel.type)) && channel.parent_id ? await api('/channels/' + channel.parent_id) : channel;
  const permissions = channelPermissions(guild, member, parent);
  if (!guildAccess({ permissions: permissions.toString(), owner: guild.owner_id === job.discordUserId }).canManage ||
      ((permissions & BigInt('8')) === BigInt(0) && (permissions & BigInt('8192')) === BigInt(0))) {
    throw new Error('Manage Messages permission is no longer available in this channel');
  }
}
function finish(job: CleanupJob) {
  job.status = job.failed || !job.reachedTarget ? 'failed' : 'completed';
  delete job.error;
  if (job.failed) job.error = job.failed + ' messages could not be deleted. See cleanup log.';
  else if (!job.reachedTarget) job.error = 'Stop message was not reached; cleanup is incomplete.';
  job.log.push('Finished: ' + job.deleted + ' deleted' + (job.failed ? ', ' + job.failed + ' failed' : '') + '.');
  persist(job);
}

// One durable page per invocation; pending IDs survive process/machine restarts.
// Never delete/recreate the Discord channel, so channel and forwarding IDs remain intact.
export async function runCleanupBatch(id: string, api: DiscordRequest = forumDiscordRequest) {
  const key = 'cleanup-worker:' + id, owner = crypto.randomUUID();
  if (!sqliteService.claimLease(key, owner)) return cleanupJob(id);
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    try { if (!sqliteService.claimLease(key, owner)) leaseLost = true; } catch { leaseLost = true; }
  }, 10_000);
  heartbeat.unref?.();
  const job = cleanupJob(id);
  try {
    if (!job || !['queued', 'running'].includes(job.status) || (job.retryAt || 0) > Date.now()) return job;
    await validateJobAuthority(job, api);
    job.status = 'running'; persist(job);
    if (!job.pendingIds.length) {
      if (job.pageDone) { finish(job); return job; }
      const messages = await api('/channels/' + job.channelId + '/messages?' + new URLSearchParams({ limit: '100', before: job.before }));
      if (!Array.isArray(messages)) throw new Error('Discord returned invalid channel history');
      if (!messages.length) { finish(job); return job; }
      job.pages++;
      job.before = messages.at(-1).id;
      let candidates = messages;
      if (job.mode === 'until') {
        // Stop at the numeric boundary even if the stop message is deleted during cleanup.
        candidates = messages.filter(message => BigInt(message.id) > BigInt(job.untilMessageId));
        if (messages.some(message => BigInt(message.id) <= BigInt(job.untilMessageId))) job.reachedTarget = true;
      }
      job.pendingIds = (job.mode === 'bot' ? candidates.filter(message => message.author?.bot || message.author?.id === job.botId) : candidates).map(message => message.id);
      job.pageDone = messages.length < 100 || (job.mode === 'until' && job.reachedTarget);
      persist(job);
    }
    const recent = job.pendingIds.filter(bulkEligible);
    if (recent.length > 1) {
      if (leaseLost) throw new Error('Cleanup lease was lost');
      try {
        await api('/channels/' + job.channelId + '/messages/bulk-delete', { method: 'POST', body: JSON.stringify({ messages: recent }) });
        job.deleted += recent.length;
        job.pendingIds = job.pendingIds.filter(id => !recent.includes(id));
        job.log.push('Deleted ' + recent.length + ' recent messages.'); persist(job);
      } catch (error) {
        job.log.push('Bulk delete unavailable; processing messages individually.'); persist(job);
      }
    }
    for (const messageId of [...job.pendingIds]) {
      if (leaseLost) throw new Error('Cleanup lease was lost');
      try {
        await api('/channels/' + job.channelId + '/messages/' + messageId, { method: 'DELETE' });
        job.deleted++;
      } catch (error: any) {
        if (error?.status === 404) job.deleted++;
        else if (!error?.status || error.status >= 500 || [401, 403, 429].includes(error?.status)) throw error;
        else { job.failed++; job.log.push(String(error?.message || error)); }
      }
      job.pendingIds = job.pendingIds.filter(id => id !== messageId);
      persist(job);
    }
    job.log.push('Page ' + job.pages + ': ' + job.deleted + ' deleted, ' + job.failed + ' failed.');
    if (job.pageDone) finish(job); else persist(job);
    return job;
  } catch (error) {
    if (job) {
      const status = Number((error as any)?.status || 0);
      const retry = (!status || status === 429 || status >= 500) && (job.retryCount || 0) < 10;
      job.status = retry ? 'queued' : 'failed'; job.error = error instanceof Error ? error.message : String(error);
      if (retry) { job.retryCount = (job.retryCount || 0) + 1; job.retryAt = Date.now() + Math.min(60_000, job.retryCount * 5000); }
      job.log.push((retry ? 'Temporary interruption; saved cleanup will retry: ' : 'Cleanup stopped: ') + job.error); persist(job);
    }
    return job;
  } finally { clearInterval(heartbeat); sqliteService.releaseLease(key, owner); }
}
