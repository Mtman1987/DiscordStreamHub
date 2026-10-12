import { sqliteService } from './sqlite-service';

export type ForumRule = {
  sourceServerId: string; destinationServerId: string; forumChannelId?: string;
  forwardingMode?: string; sharedThreadId?: string; restrictToWhitelist?: boolean;
  sourceChannelWhitelist?: string[]; mappings?: Record<string, string>; labels?: Record<string, string>;
};
export class ForumDiscordError extends Error {
  constructor(public status: number, public code: number, message: string) { super(message); }
}
export type DiscordRequest = (path: string, options?: RequestInit) => Promise<any>;
export const forumDiscordRequest: DiscordRequest = async (path, options = {}) => {
  if (!process.env.DISCORD_BOT_TOKEN) throw new Error('Discord bot is not configured');
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch('https://discord.com/api/v10' + path, {
      ...options, headers: { Authorization: 'Bot ' + process.env.DISCORD_BOT_TOKEN, 'Content-Type': 'application/json', ...options.headers },
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.status === 429 && attempt < 3 && Number(body?.retry_after) <= 5) {
      await new Promise(resolve => setTimeout(resolve, Math.max(100, Number(body.retry_after) * 1000 + 100))); continue;
    }
    if (!response.ok) throw new ForumDiscordError(response.status, Number(body?.code || 0), 'Discord ' + response.status + ': ' + String(body?.message || response.statusText));
    return body;
  }
  throw new Error('Discord request exhausted');
};
export const rulePath = (guildId: string) => 'servers/' + guildId + '/config/forwardingForums';
export function loadForumRule(guildId: string): ForumRule | null {
  const value = sqliteService.getDoc(rulePath(guildId));
  return value.exists ? { ...value.data, sourceServerId: guildId } : null;
}
export function mirrorChannelAllowed(rule: ForumRule, channelId: string) {
  return !rule.restrictToWhitelist || !rule.sourceChannelWhitelist?.length || rule.sourceChannelWhitelist.includes(channelId);
}
export function mirrorThreadName(name: string, sourceGuildId: string, channelId: string) {
  const suffix = ' [' + sourceGuildId + ':' + channelId + ']';
  return (name.replace(/^#+/, '').trim() || 'channel').slice(0, 100 - suffix.length) + suffix;
}

async function allForumThreads(rule: ForumRule, api: DiscordRequest) {
  const active = await api('/guilds/' + rule.destinationServerId + '/threads/active');
  const found = new Map<string, any>();
  for (const thread of active.threads || []) if (thread.parent_id === rule.forumChannelId) found.set(thread.id, thread);
  let before = '';
  for (let page = 0; page < 1000; page++) {
    const query = new URLSearchParams({ limit: '100' });
    if (before) query.set('before', before);
    const batch = await api('/channels/' + rule.forumChannelId + '/threads/archived/public?' + query);
    for (const thread of batch.threads || []) found.set(thread.id, thread);
    if (!batch.has_more) return [...found.values()];
    const next = batch.threads?.at(-1)?.thread_metadata?.archive_timestamp;
    if (!next || next === before) throw new Error('Cannot finish archived thread lookup; refusing to create a duplicate');
    before = next;
  }
  throw new Error('Archived thread lookup exceeded its limit');
}

async function makeUsable(threadId: string, rule: ForumRule, api: DiscordRequest) {
  const thread = await api('/channels/' + threadId);
  if (![10, 11, 12].includes(Number(thread.type)) || thread.guild_id !== rule.destinationServerId ||
      (rule.forwardingMode !== 'single-thread' && thread.parent_id !== rule.forumChannelId)) {
    throw new Error('Saved thread is outside the configured destination. Update the forwarding rule.');
  }
  if (thread.thread_metadata?.archived) {
    await api('/channels/' + threadId, { method: 'PATCH', body: JSON.stringify({ archived: false }) });
  }
  return thread;
}

// SQLite leases serialize setup, concurrent messages and multiple web processes.
// A persisted pending marker makes an ambiguous Discord create fail closed.
// Recovery scans both active and archived threads before any new creation.
export async function ensureMirrorThread(rule: ForumRule, channel: { id: string; name: string }, api: DiscordRequest = forumDiscordRequest) {
  if (rule.forwardingMode === 'single-thread') {
    if (!rule.sharedThreadId) throw new Error('Shared destination thread is required');
    await makeUsable(rule.sharedThreadId, rule, api);
    return { threadId: rule.sharedThreadId, created: false };
  }
  if (!rule.forumChannelId) throw new Error('Destination forum channel is required');
  const key = rule.destinationServerId + ':' + rule.forumChannelId + ':' + rule.sourceServerId + ':' + channel.id;
  const owner = crypto.randomUUID();
  for (let attempt = 0; !sqliteService.claimLease(key, owner); attempt++) {
    if (attempt >= 100) throw new Error('Thread synchronization is busy. Retry shortly.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    try { if (!sqliteService.claimLease(key, owner)) leaseLost = true; } catch { leaseLost = true; }
  }, 10_000);
  heartbeat.unref?.();
  const statePath = 'forwardingThreadState/' + key;
  try {
    const latest = loadForumRule(rule.sourceServerId);
    if (!latest || latest.destinationServerId !== rule.destinationServerId || latest.forumChannelId !== rule.forumChannelId ||
        latest.forwardingMode === 'single-thread' || !mirrorChannelAllowed(latest, channel.id)) throw new Error('Forwarding configuration changed. Retry with the current rule.');
    const state = sqliteService.getDoc(statePath).data || {};
    const mappingKey = rule.sourceServerId + ':' + channel.id;
    const savedId = latest.mappings?.[mappingKey] || latest.mappings?.[channel.id] || state.threadId;
    if (savedId) {
      // Permission failures, rate limits and deleted threads never authorize replacement.
      const savedThread = await makeUsable(savedId, rule, api);
      const marker = '[' + rule.sourceServerId + ':' + channel.id + ']';
      if (String(savedThread.name).endsWith(marker) && savedThread.name !== mirrorThreadName(channel.name, rule.sourceServerId, channel.id)) {
        await api('/channels/' + savedId, { method: 'PATCH', body: JSON.stringify({ name: mirrorThreadName(channel.name, rule.sourceServerId, channel.id) }) });
      }
      sqliteService.mergeDocMaps(rulePath(rule.sourceServerId), { mappings: { [mappingKey]: savedId }, labels: { [mappingKey]: channel.name } });
      return { threadId: String(savedId), created: false };
    }
    const parent = await api('/channels/' + rule.forumChannelId);
    if (![15, 16].includes(Number(parent.type)) || parent.guild_id !== rule.destinationServerId) throw new Error('Destination must be a forum/media channel in the selected server');
    const threads = await allForumThreads(rule, api);
    const marker = '[' + rule.sourceServerId + ':' + channel.id + ']';
    let matches = threads.filter(thread => String(thread.name).endsWith(marker));
    if (!matches.length) {
      // Recover pre-marker threads only when the original bot footer confirms their source.
      const guild = await api('/guilds/' + rule.sourceServerId);
      const legacy = threads.filter(thread => thread.name === channel.name || thread.name === latest.labels?.[mappingKey]);
      for (const thread of legacy) {
        const starter = await api('/channels/' + thread.id + '/messages/' + thread.id);
        if (starter.author?.bot && starter.embeds?.some((e: any) => e.footer?.text === guild.name + ' · #' + channel.name)) matches.push(thread);
      }
    }
    if (matches.length > 1) throw new Error('Multiple existing threads match this channel. Select its canonical thread in advanced overrides.');
    let threadId = matches[0]?.id;
    let created = false;
    if (!threadId) {
      if (leaseLost || !sqliteService.claimLease(key, owner)) throw new Error('Thread synchronization lease was lost. Retry.');
      if (state.pending) throw new Error('A previous thread creation has an unknown result. Refresh synchronization; no duplicate will be created.');
      sqliteService.setDoc(statePath, { pending: true, sourceServerId: rule.sourceServerId, sourceChannelId: channel.id, startedAt: new Date().toISOString() });
      let thread;
      try {
        thread = await api('/channels/' + rule.forumChannelId + '/threads', { method: 'POST', body: JSON.stringify({
          name: mirrorThreadName(channel.name, rule.sourceServerId, channel.id),
          auto_archive_duration: 10080,
          ...(parent.available_tags?.length && (Number(parent.flags || 0) & 16) ? { applied_tags: [parent.available_tags.find((t: any) => !t.moderated)?.id || parent.available_tags[0].id] } : {}),
          message: { content: 'Messages from <#' + channel.id + '> are mirrored here.\nSource: https://discord.com/channels/' + rule.sourceServerId + '/' + channel.id,
            allowed_mentions: { parse: [] } },
        }) });
      } catch (error) {
        // An explicit 4xx (except timeout) proves no thread was created. Network/5xx is ambiguous.
        if (error instanceof ForumDiscordError && error.status >= 400 && error.status < 500 && error.status !== 408) sqliteService.deleteDoc(statePath);
        throw error;
      }
      if (!thread?.id) throw new Error('Discord did not confirm thread creation');
      threadId = thread.id;
      created = true;
    }
    sqliteService.setDoc(statePath, { threadId, pending: false, sourceServerId: rule.sourceServerId, sourceChannelId: channel.id, updatedAt: new Date().toISOString() });
    sqliteService.mergeDocMaps(rulePath(rule.sourceServerId), { mappings: { [mappingKey]: threadId }, labels: { [mappingKey]: channel.name } });
    await makeUsable(threadId, rule, api);
    return { threadId: String(threadId), created };
  } finally {
    clearInterval(heartbeat);
    sqliteService.releaseLease(key, owner);
  }
}

export async function syncForumChannels(rule: ForumRule, api: DiscordRequest = forumDiscordRequest) {
  if (rule.forwardingMode === 'single-thread') {
    await ensureMirrorThread(rule, { id: '', name: '' }, api);
    return { total: 1, created: 0, reused: 1, errors: [] as Array<{ channelId: string; error: string }> };
  }
  const channels = await api('/guilds/' + rule.sourceServerId + '/channels');
  const sources = channels.filter((c: any) => [0, 2, 5, 13, 15, 16].includes(Number(c.type)) && mirrorChannelAllowed(rule, c.id) &&
    !(rule.sourceServerId === rule.destinationServerId && c.id === rule.forumChannelId));
  let created = 0, reused = 0;
  const errors: Array<{ channelId: string; error: string }> = [];
  const inventory = new Map<string, Promise<any>>();
  const syncApi: DiscordRequest = (path, options) => {
    if (!options && (path.includes('/threads/active') || path.includes('/threads/archived/public') || path === '/guilds/' + rule.sourceServerId || path === '/channels/' + rule.forumChannelId)) {
      if (!inventory.has(path)) inventory.set(path, api(path, options));
      return inventory.get(path)!;
    }
    return api(path, options);
  };
  for (const channel of sources) {
    try {
      const result = await ensureMirrorThread(rule, channel, syncApi);
      if (result.created) created++; else reused++;
    } catch (error) { errors.push({ channelId: channel.id, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { total: sources.length, created, reused, errors };
}
