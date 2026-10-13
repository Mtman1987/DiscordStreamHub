import { sqliteService } from './sqlite-service';
import { isPublicMirrorSource } from './discord-mirror-privacy';

export type ForumRule = {
  sourceServerId: string; destinationServerId: string; forumChannelId?: string;
  forwardingMode?: string; sharedThreadId?: string; restrictToWhitelist?: boolean;
  sourceChannelWhitelist?: string[]; paused?: boolean; mappings?: Record<string, string>; labels?: Record<string, string>;
};
export class ForumDiscordError extends Error {
  constructor(public status: number, public code: number, message: string) { super(message); }
}
export type DiscordRequest = (path: string, options?: RequestInit) => Promise<any>;
export const forumDiscordRequest: DiscordRequest = async (path, options = {}) => {
  if (!process.env.DISCORD_BOT_TOKEN) throw new Error('Discord bot is not configured');
  const method = String(options.method || 'GET').toUpperCase();
  const retrySafe = method === 'GET' || method === 'HEAD';
  const retryDelaysMs = [250, 500, 1000];

  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response;
    try {
      response = await fetch('https://discord.com/api/v10' + path, {
        ...options, headers: { Authorization: 'Bot ' + process.env.DISCORD_BOT_TOKEN, 'Content-Type': 'application/json', ...options.headers },
        cache: 'no-store', signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      // Inventory reads can fail transiently during a deploy or a short Discord/network
      // stall. Retry only idempotent reads; never replay a message/thread write.
      if (retrySafe && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, retryDelaysMs[attempt]));
        continue;
      }
      throw error;
    }

    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.status === 429 && attempt < 3 && Number(body?.retry_after) <= 5) {
      await new Promise(resolve => setTimeout(resolve, Math.max(100, Number(body.retry_after) * 1000 + 100)));
      continue;
    }
    if (retrySafe && attempt < 3 && (response.status === 408 || response.status >= 500)) {
      await new Promise(resolve => setTimeout(resolve, retryDelaysMs[attempt]));
      continue;
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
export async function publicMirrorChannel(guildId: string, channelId: string, api: DiscordRequest = forumDiscordRequest) {
  const [guild, channel] = await Promise.all([api('/guilds/' + guildId), api('/channels/' + channelId)]);
  return isPublicMirrorSource(guild, channel);
}

// Delete only proven destination copies; never touch a source channel.
// The same lease used by creation prevents a cleanup/create race.
export async function removeRestrictedMirror(rule: ForumRule, channelId: string, api: DiscordRequest = forumDiscordRequest) {
  const key = rule.destinationServerId + ':' + rule.forumChannelId + ':' + rule.sourceServerId + ':' + channelId;
  const owner = crypto.randomUUID();
  if (!sqliteService.claimLease(key, owner)) throw new Error('Mirror cleanup is busy; forwarding is blocked.');
  try {
    const latest = loadForumRule(rule.sourceServerId);
    if (!latest || latest.destinationServerId !== rule.destinationServerId || latest.forumChannelId !== rule.forumChannelId) throw new Error('Forwarding configuration changed.');
    const statePath = 'forwardingThreadState/' + key;
    const state = sqliteService.getDoc(statePath).data || {};
    const mappingKey = rule.sourceServerId + ':' + channelId;
    const history = sqliteService.getCollection('servers/' + rule.sourceServerId + '/forwardedMessages').docs.filter((row: any) =>
      row.destinationServerId === rule.destinationServerId && String(row.originSourceChannelId || row.originChannelId) === channelId);
    if (rule.forwardingMode === 'single-thread') {
      for (const row of history) {
        if (row.forwardedThreadId !== rule.sharedThreadId) continue;
        await api('/channels/' + row.forwardedThreadId + '/messages/' + row.forwardedMessageId, { method: 'DELETE' }).catch(error => {
          if (!(error instanceof ForumDiscordError && error.status === 404)) throw error;
        });
      }
    } else {
      const ids = new Set<string>([latest.mappings?.[mappingKey], latest.mappings?.[channelId], state.threadId,
        ...(state.duplicateThreadIds || []), ...history.map((row: any) => row.forwardedThreadId)].filter(Boolean));
      for (const id of ids) {
        let thread;
        try { thread = await api('/channels/' + id); }
        catch (error) { if (error instanceof ForumDiscordError && error.status === 404 && error.code === 10003) continue; throw error; }
        if (thread.guild_id !== rule.destinationServerId || thread.parent_id !== rule.forumChannelId || ![10, 11, 12].includes(Number(thread.type))) {
          if (id === latest.mappings?.[mappingKey] || id === latest.mappings?.[channelId] || id === state.threadId) throw new Error('Refusing to delete an unrelated channel during privacy cleanup.');
          continue; // History can reference a previous destination forum.
        }
        await api('/channels/' + id, { method: 'DELETE' });
      }
    }
    sqliteService.removeDocMapEntries(rulePath(rule.sourceServerId), { mappings: [mappingKey, channelId], labels: [mappingKey, channelId] },
      { destinationServerId: rule.destinationServerId, forumChannelId: rule.forumChannelId });
    sqliteService.deleteDoc(statePath);
    for (const row of history) {
      sqliteService.deleteDoc('servers/' + rule.sourceServerId + '/forwardedMessages/' + row.id);
      for (const index of ['forwarded_' + row.forwardedMessageId, 'origin_' + row.originMessageId]) {
        const path = 'forwardedMessageIndex/' + index;
        if (sqliteService.getDoc(path).data?.forwardedMessageId === row.forwardedMessageId) sqliteService.deleteDoc(path);
      }
    }
  } finally { sqliteService.releaseLease(key, owner); }
}

export function mirrorThreadName(name: string, _sourceGuildId?: string, _channelId?: string) {
  return (name.replace(/^#+/, '').trim() || 'channel').slice(0, 100);
}
export function assertExclusiveMirrorForum(rule: ForumRule) {
  for (const sourceId of sqliteService.listDescendantDocumentIds('servers')) {
    if (sourceId === rule.sourceServerId) continue;
    const other = loadForumRule(sourceId);
    if (other?.forwardingMode !== 'single-thread' && other?.destinationServerId === rule.destinationServerId && other?.forumChannelId === rule.forumChannelId) {
      throw new Error('Each mirrored server needs its own destination forum. Choose a separate forum.');
    }
  }
}
function friendlyMirrorName(rule: ForumRule, channel: { id: string; name: string; type?: number }) {
  const list = sqliteService.getDoc('servers/' + rule.sourceServerId + '/config/channels').data?.list || [];
  const same = list.filter((item: any) => [0, 2, 5, 13].includes(Number(item.type)) && item.name === channel.name);
  if (!same.some((item: any) => item.id === channel.id)) same.push(channel);
  if (same.length < 2) return mirrorThreadName(channel.name);
  const own = same.find((item: any) => item.id === channel.id);
  const kind = (type: number) => ({ 0: 'text', 2: 'voice', 5: 'announcements', 13: 'stage' }[type] || 'text');
  const peers = same.filter((item: any) => kind(Number(item.type)) === kind(Number(own?.type))).sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
  const suffix = ' (' + kind(Number(own?.type)) + (peers.length > 1 ? ' ' + (peers.findIndex((item: any) => item.id === channel.id) + 1) : '') + ')';
  return mirrorThreadName(channel.name).slice(0, 100 - suffix.length) + suffix;
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
export async function ensureMirrorThread(rule: ForumRule, channel: { id: string; name: string; type?: number }, api: DiscordRequest = forumDiscordRequest) {
  if (rule.paused) throw new Error('Forum forwarding is paused while its destination is being reset.');
  if ([15, 16].includes(Number(channel.type))) throw new Error('Forum and media source channels are excluded from mirroring.');
  if (!await publicMirrorChannel(rule.sourceServerId, channel.id, api)) throw new Error('Restricted source channels cannot be mirrored publicly.');
  if (rule.forwardingMode === 'single-thread') {
    if (!rule.sharedThreadId) throw new Error('Shared destination thread is required');
    await makeUsable(rule.sharedThreadId, rule, api);
    return { threadId: rule.sharedThreadId, created: false };
  }
  if (!rule.forumChannelId) throw new Error('Destination forum channel is required');
  assertExclusiveMirrorForum(rule);
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
    if (!latest || latest.paused || latest.destinationServerId !== rule.destinationServerId || latest.forumChannelId !== rule.forumChannelId ||
        latest.forwardingMode === 'single-thread' || !mirrorChannelAllowed(latest, channel.id)) throw new Error('Forwarding configuration changed. Retry with the current rule.');
    if (!await publicMirrorChannel(rule.sourceServerId, channel.id, api)) throw new Error('Restricted source channels cannot be mirrored publicly.');
    const state = sqliteService.getDoc(statePath).data || {};
    const mappingKey = rule.sourceServerId + ':' + channel.id;
    const threadName = friendlyMirrorName(rule, channel);
    const savedId = latest.mappings?.[mappingKey] || latest.mappings?.[channel.id] || state.threadId;
    let savedThread: any = null;
    if (savedId) {
      try { savedThread = await makeUsable(savedId, rule, api); }
      catch (error) {
        // A confirmed deleted channel can be replaced. Permission/network errors
        // never authorize creating a second copy.
        if (!(error instanceof ForumDiscordError && error.status === 404 && error.code === 10003)) throw error;
      }
    }
    if (savedThread && savedThread.name === threadName && !state.duplicateThreadIds?.length) {
      sqliteService.mergeDocMaps(rulePath(rule.sourceServerId), { mappings: { [mappingKey]: savedId }, labels: { [mappingKey]: channel.name } }, {}, { destinationServerId: rule.destinationServerId, forumChannelId: rule.forumChannelId, paused: false });
      return { threadId: String(savedId), created: false };
    }
    const parent = await api('/channels/' + rule.forumChannelId);
    if (![15, 16].includes(Number(parent.type)) || parent.guild_id !== rule.destinationServerId) throw new Error('Destination must be a forum/media channel in the selected server');
    const threads = await allForumThreads(rule, api);
    const bot = await api('/users/@me');
    const history = sqliteService.getCollection('servers/' + rule.sourceServerId + '/forwardedMessages').docs;
    const matchingHistory = history.filter((message: any) => String(message.originSourceChannelId || message.originChannelId) === channel.id &&
      message.destinationServerId === rule.destinationServerId);
    const historicalIds = new Set(matchingHistory.map((message: any) => message.forwardedThreadId));
    const foreignIds = new Set(history.filter((message: any) => String(message.originSourceChannelId || message.originChannelId) !== channel.id)
      .map((message: any) => message.forwardedThreadId));
    const marker = '[' + rule.sourceServerId + ':' + channel.id + ']'; // Read old names only; never display new IDs.
    const matches = threads.filter(thread => historicalIds.has(thread.id) || String(thread.name).endsWith(marker) ||
      (thread.name === threadName && thread.owner_id === bot.id && !foreignIds.has(thread.id)));
    if (savedThread && !matches.some(thread => thread.id === savedThread.id)) matches.push(savedThread);
    matches.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
    let threadId = savedThread?.id || matches[0]?.id;
    let created = false;
    // Delete redundant bot-owned copies before creating/reusing a canonical thread.
    // Failure stops synchronization, so it cannot silently leave another copy.
    const redundantIds = new Set([...matches.filter(thread => thread.id !== threadId).map(thread => thread.id),
      ...(state.duplicateThreadIds || []).filter((id: string) => id !== threadId)]);
    for (const duplicateId of redundantIds) {
      if (leaseLost) throw new Error('Thread synchronization lease was lost.');
      const duplicate = threads.find(thread => thread.id === duplicateId);
      if (!duplicate) continue; // A successful full active+archive scan confirms it is absent.
      if (duplicate.owner_id !== bot.id && !historicalIds.has(duplicateId) && !String(duplicate.name).endsWith(marker)) {
        throw new Error('A duplicate thread is not bot-owned. Remove or rename it before syncing.');
      }
      await api('/channels/' + duplicateId, { method: 'DELETE' });
    }
    if (!threadId) {
      if (leaseLost || !sqliteService.claimLease(key, owner)) throw new Error('Thread synchronization lease was lost. Retry.');
      if (state.pending) throw new Error('A previous thread creation has an unknown result. Refresh synchronization; no duplicate will be created.');
      sqliteService.setDoc(statePath, { pending: true, sourceServerId: rule.sourceServerId, sourceChannelId: channel.id, startedAt: new Date().toISOString() });
      const sourceGuild = await api('/guilds/' + rule.sourceServerId);
      let thread;
      try {
        thread = await api('/channels/' + rule.forumChannelId + '/threads', { method: 'POST', body: JSON.stringify({
          name: threadName, auto_archive_duration: 10080,
          ...(parent.available_tags?.length && (Number(parent.flags || 0) & 16) ? { applied_tags: [parent.available_tags.find((t: any) => !t.moderated)?.id || parent.available_tags[0].id] } : {}),
          message: { content: 'Messages from **#' + channel.name + '** in **' + sourceGuild.name + '** are mirrored here.',
            allowed_mentions: { parse: [] } },
        }) });
      } catch (error) {
        if (error instanceof ForumDiscordError && error.status >= 400 && error.status < 500 && error.status !== 408) sqliteService.deleteDoc(statePath);
        throw error;
      }
      if (!thread?.id) throw new Error('Discord did not confirm thread creation');
      threadId = thread.id; created = true;
    }
    const usable = await makeUsable(threadId, rule, api);
    if (usable.name !== threadName) await api('/channels/' + threadId, { method: 'PATCH', body: JSON.stringify({ name: threadName }) });
    sqliteService.setDoc(statePath, { threadId, duplicateThreadIds: [], pending: false, sourceServerId: rule.sourceServerId, sourceChannelId: channel.id, updatedAt: new Date().toISOString() });
    sqliteService.mergeDocMaps(rulePath(rule.sourceServerId), { mappings: { [mappingKey]: threadId }, labels: { [mappingKey]: channel.name } }, {}, { destinationServerId: rule.destinationServerId, forumChannelId: rule.forumChannelId, paused: false });
    return { threadId: String(threadId), created };
  } finally { clearInterval(heartbeat); sqliteService.releaseLease(key, owner); }
}

export async function syncForumChannels(rule: ForumRule, api: DiscordRequest = forumDiscordRequest) {
  const [channels, guild] = await Promise.all([api('/guilds/' + rule.sourceServerId + '/channels'), api('/guilds/' + rule.sourceServerId)]);
  for (const channel of channels) {
    if ([0, 2, 5, 13].includes(Number(channel.type)) && !isPublicMirrorSource(guild, channel)) await removeRestrictedMirror(rule, channel.id, api);
  }
  if (rule.forwardingMode === 'single-thread') {
    if (rule.paused) throw new Error('Forum forwarding is paused.');
    if (!rule.sharedThreadId) throw new Error('Shared destination thread is required');
    await makeUsable(rule.sharedThreadId, rule, api);
    return { total: 1, created: 0, reused: 1, errors: [] as Array<{ channelId: string; error: string }> };
  }
  sqliteService.setDoc('servers/' + rule.sourceServerId + '/config/channels', { list: channels.map((c: any) => ({ id: c.id, name: c.name, type: c.type })) }, true);
  const sources = channels.filter((c: any) => isPublicMirrorSource(guild, c) && mirrorChannelAllowed(rule, c.id) &&
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
