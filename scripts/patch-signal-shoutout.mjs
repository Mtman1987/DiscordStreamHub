import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function patch(relativePath, transform) {
  const file = path.join(root, relativePath);
  const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const after = transform(before);
  if (after === before) {
    console.log(`[SignalPatch] already applied: ${relativePath}`);
    return;
  }
  fs.writeFileSync(file, after, 'utf8');
  console.log(`[SignalPatch] applied: ${relativePath}`);
}

patch('src/app/api/discord/manual-shoutout/route.ts', (source) => {
  if (!source.includes("const kind = body.kind === 'signal' ? 'signal' : 'manual';")) {
    source = source.replace(
      "    const sourceMessageId = String(body.sourceMessageId || '').trim() || null;",
      "    const sourceMessageId = String(body.sourceMessageId || '').trim() || null;\n    const kind = body.kind === 'signal' ? 'signal' : 'manual';\n    const signalText = String(body.signalText || '').trim().slice(0, 1800) || null;"
    );
  }
  if (!source.includes('      kind,\n      signalText,')) {
    source = source.replace(
      '      sourceMessageId,\n    });',
      '      sourceMessageId,\n      kind,\n      signalText,\n    });'
    );
  }
  return source;
});

patch('src/lib/manual-discord-shoutout-service.ts', (source) => {
  if (!source.includes("kind?: 'manual' | 'signal';")) {
    source = source.replace(
      '  sourceMessageId?: string | null;\n  createdAt: string;',
      "  sourceMessageId?: string | null;\n  kind?: 'manual' | 'signal';\n  signalText?: string | null;\n  suppressedAt?: string | null;\n  createdAt: string;"
    );
    source = source.replace(
      '  sourceMessageId?: string | null;\n};\n\ntype ResolvedManualTarget',
      "  sourceMessageId?: string | null;\n  kind?: 'manual' | 'signal';\n  signalText?: string | null;\n};\n\ntype ResolvedManualTarget"
    );
  } else if (!source.includes('suppressedAt?: string | null;')) {
    source = source.replace(
      '  signalText?: string | null;\n  createdAt: string;',
      '  signalText?: string | null;\n  suppressedAt?: string | null;\n  createdAt: string;'
    );
  }

  if (!source.includes('kind: input.kind || \'manual\'')) {
    source = source.replace(
      '    sourceMessageId: input.sourceMessageId || null,\n    createdAt:',
      "    sourceMessageId: input.sourceMessageId || null,\n    kind: input.kind || 'manual',\n    signalText: input.signalText || null,\n    suppressedAt: null,\n    createdAt:"
    );
  } else if (!source.includes('    suppressedAt: null,')) {
    source = source.replace(
      '    signalText: input.signalText || null,\n    createdAt:',
      '    signalText: input.signalText || null,\n    suppressedAt: null,\n    createdAt:'
    );
  }

  if (!source.includes("const isSignal = entry.kind === 'signal';")) {
    source = source.replace(
      '  const embeds: any[] = [];',
      "  const isSignal = entry.kind === 'signal';\n  const embeds: any[] = [];"
    );
    source = source.replace(
      '      name: `${displayName} Manual Shoutout`,',
      "      name: isSignal ? '📡 INCOMING SIGNAL' : `${displayName} Manual Shoutout`,"
    );
    source = source.replace(
      "    title: isLive ? `${displayName} is LIVE on Twitch` : `Shoutout for ${displayName}`,\n    description: entry.aiShoutout,",
      "    title: isSignal\n      ? (isLive ? `${displayName} // LIVE CARRIER LOCKED` : `${displayName} // CARRIER LOCATED`)\n      : (isLive ? `${displayName} is LIVE on Twitch` : `Shoutout for ${displayName}`),\n    description: isSignal ? (entry.signalText || `A transmission from @${entry.requesterName} has crossed the network.`) : entry.aiShoutout,"
    );
    source = source.replace(
      "        name: 'Called By',\n        value: `@${entry.requesterName}`,",
      "        name: isSignal ? 'Transmitted By' : 'Called By',\n        value: `@${entry.requesterName}`,"
    );
    source = source.replace(
      "      text: entry.trackWhileLive\n        ? 'Discord manual shoutout • refreshes every 10 minutes while live'\n        : 'Discord manual shoutout • posted while offline',",
      "      text: isSignal\n        ? (entry.trackWhileLive ? 'SpaceMountain Signal • carrier refreshes while live' : 'SpaceMountain Signal • carrier retained for 1 hour')\n        : (entry.trackWhileLive\n          ? 'Discord manual shoutout • refreshes every 10 minutes while live'\n          : 'Discord manual shoutout • posted while offline'),"
    );
  }

  if (!source.includes("label: 'Remove Signal'")) {
    source = source.replace(
      "  if (entry.partnerDiscordLink) {\n    buttons.push({",
      "  if (isSignal) {\n    buttons.push({\n      type: 2,\n      style: 4,\n      label: 'Remove Signal',\n      custom_id: `signal_shoutout_delete:${entry.id}`,\n      emoji: { name: '🗑️' },\n    });\n  }\n\n  if (entry.partnerDiscordLink) {\n    buttons.push({"
    );
  }

  if (!source.includes("&& (item?.kind || 'manual') === (kind || 'manual')")) {
    source = source.replace(
      'async function getExistingManualRecord(serverId: string, channelId: string, twitchLogin: string): Promise<ManualDiscordShoutoutRecord | null> {',
      "async function getExistingManualRecord(serverId: string, channelId: string, twitchLogin: string, kind: 'manual' | 'signal' = 'manual'): Promise<ManualDiscordShoutoutRecord | null> {"
    );
    source = source.replace(
      '.find((item: any) => item?.channelId === channelId && item?.twitchLogin === twitchLogin);',
      ".find((item: any) => item?.channelId === channelId && item?.twitchLogin === twitchLogin && !item?.suppressedAt && (item?.kind || 'manual') === (kind || 'manual'));"
    );
    source = source.replace(
      '  const existing = await getExistingManualRecord(input.serverId, input.channelId, resolved.twitchLogin);',
      "  const existing = await getExistingManualRecord(input.serverId, input.channelId, resolved.twitchLogin, input.kind || 'manual');"
    );
  } else if (!source.includes('&& !item?.suppressedAt')) {
    source = source.replace(
      ".find((item: any) => item?.channelId === channelId && item?.twitchLogin === twitchLogin && (item?.kind || 'manual') === (kind || 'manual'));",
      ".find((item: any) => item?.channelId === channelId && item?.twitchLogin === twitchLogin && !item?.suppressedAt && (item?.kind || 'manual') === (kind || 'manual'));"
    );
  }

  if (!source.includes('export async function removeSignalDiscordShoutout')) {
    source = source.replace(
      'export async function refreshManualDiscordShoutouts(serverId: string): Promise<void> {',
      `export async function removeSignalDiscordShoutout(input: {\n  serverId: string;\n  recordId: string;\n  actorDiscordId: string;\n  isModerator: boolean;\n}): Promise<{ removed: boolean; authorized: boolean }> {\n  const serverId = String(input.serverId || '').trim();\n  const recordId = String(input.recordId || '').trim();\n  const actorDiscordId = String(input.actorDiscordId || '').trim();\n  if (!serverId || !recordId || !actorDiscordId) return { removed: false, authorized: false };\n\n  const ref = manualCollection(serverId).doc(recordId);\n  const snapshot = await ref.get();\n  if (!snapshot.exists) return { removed: true, authorized: true };\n  const entry = snapshot.data() as ManualDiscordShoutoutRecord;\n  if ((entry.kind || 'manual') !== 'signal') return { removed: false, authorized: false };\n\n  let requesterDiscordId = String(entry.requesterDiscordId || '').trim();\n  if (!requesterDiscordId) {\n    const linkedRequester = await getLinkedUserByTwitchLogin(serverId, normalizeTwitchLogin(entry.requesterName)).catch(() => null);\n    requesterDiscordId = String(linkedRequester?.id || '').trim();\n  }\n  const authorized = input.isModerator || (requesterDiscordId && requesterDiscordId === actorDiscordId);\n  if (!authorized) return { removed: false, authorized: false };\n\n  await ref.set({\n    suppressedAt: new Date().toISOString(),\n    trackWhileLive: false,\n    updatedAt: new Date().toISOString(),\n  }, { merge: true });\n  if (entry.messageId) {\n    await deleteDiscordMessage(serverId, entry.channelId, entry.messageId).catch(() => {});\n  }\n  return { removed: true, authorized: true };\n}\n\nexport async function refreshManualDiscordShoutouts(serverId: string): Promise<void> {`
    );
  }

  if (!source.includes('if (entry.suppressedAt) continue;')) {
    source = source.replace(
      '  for (const entry of entries) {\n    try {',
      '  for (const entry of entries) {\n    try {\n      if (entry.suppressedAt) continue;'
    );
  }

  if (!source.includes('const currentRecord = await manualCollection(serverId).doc(entry.id).get();')) {
    source = source.replace(
      'async function updateManualRecord(serverId: string, entry: ManualDiscordShoutoutRecord): Promise<void> {',
      `async function updateManualRecord(serverId: string, entry: ManualDiscordShoutoutRecord): Promise<void> {\n  const currentRecord = await manualCollection(serverId).doc(entry.id).get();\n  if (!currentRecord.exists || currentRecord.data()?.suppressedAt) return;`
    );
  }

  return source;
});

patch('src/app/api/discord/interactions/route.ts', (source) => {
  if (!source.includes("removeSignalDiscordShoutout")) {
    source = source.replace(
      "import { setSignalSeekerMembership } from '@/lib/signal-seeker-service';",
      "import { setSignalSeekerMembership } from '@/lib/signal-seeker-service';\nimport { removeSignalDiscordShoutout } from '@/lib/manual-discord-shoutout-service';"
    );
  }

  if (!source.includes('function discordMemberCanRemoveSignal')) {
    source = source.replace(
      'function discordAvatarUrl(user: any) {',
      `function discordMemberCanRemoveSignal(member: any) {\n  try {\n    const permissions = BigInt(String(member?.permissions || '0') || '0');\n    const ADMINISTRATOR = BigInt(0x8);\n    const MANAGE_MESSAGES = BigInt(0x2000);\n    const MANAGE_GUILD = BigInt(0x20);\n    return Boolean(permissions & ADMINISTRATOR || permissions & MANAGE_MESSAGES || permissions & MANAGE_GUILD);\n  } catch {\n    return false;\n  }\n}\n\nfunction discordAvatarUrl(user: any) {`
    );
  }

  if (!source.includes("customId.startsWith('signal_shoutout_delete:')")) {
    source = source.replace(
      "    if (body.type === 3 && customId) {\n      if (customId.startsWith('signal_seekers:')) {",
      `    if (body.type === 3 && customId) {\n      if (customId.startsWith('signal_shoutout_delete:')) {\n        const serverId = String(body.guild_id || '').trim();\n        const actorDiscordId = String(body.member?.user?.id || body.user?.id || '').trim();\n        const recordId = customId.slice('signal_shoutout_delete:'.length);\n        if (!serverId || !actorDiscordId || !recordId) return ephemeral('🚫 This Signal control is invalid.');\n        const result = await removeSignalDiscordShoutout({\n          serverId,\n          recordId,\n          actorDiscordId,\n          isModerator: discordMemberCanRemoveSignal(body.member),\n        });\n        if (!result.authorized) return ephemeral('🚫 Only the person who sent this Signal or a moderator can remove it.');\n        return ephemeral('🗑️ Signal removed from the shoutout rotation.');\n      }\n\n      if (customId.startsWith('signal_seekers:')) {`
    );
  }

  return source;
});
