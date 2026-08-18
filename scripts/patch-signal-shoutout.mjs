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
      "  sourceMessageId?: string | null;\n  kind?: 'manual' | 'signal';\n  signalText?: string | null;\n  createdAt: string;"
    );
    source = source.replace(
      '  sourceMessageId?: string | null;\n};\n\ntype ResolvedManualTarget',
      "  sourceMessageId?: string | null;\n  kind?: 'manual' | 'signal';\n  signalText?: string | null;\n};\n\ntype ResolvedManualTarget"
    );
  }

  if (!source.includes('kind: input.kind || \'manual\'')) {
    source = source.replace(
      '    sourceMessageId: input.sourceMessageId || null,\n    createdAt:',
      "    sourceMessageId: input.sourceMessageId || null,\n    kind: input.kind || 'manual',\n    signalText: input.signalText || null,\n    createdAt:"
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

  if (!source.includes("&& (item?.kind || 'manual') === (kind || 'manual')")) {
    source = source.replace(
      'async function getExistingManualRecord(serverId: string, channelId: string, twitchLogin: string): Promise<ManualDiscordShoutoutRecord | null> {',
      "async function getExistingManualRecord(serverId: string, channelId: string, twitchLogin: string, kind: 'manual' | 'signal' = 'manual'): Promise<ManualDiscordShoutoutRecord | null> {"
    );
    source = source.replace(
      '.find((item: any) => item?.channelId === channelId && item?.twitchLogin === twitchLogin);',
      ".find((item: any) => item?.channelId === channelId && item?.twitchLogin === twitchLogin && (item?.kind || 'manual') === (kind || 'manual'));"
    );
    source = source.replace(
      '  const existing = await getExistingManualRecord(input.serverId, input.channelId, resolved.twitchLogin);',
      "  const existing = await getExistingManualRecord(input.serverId, input.channelId, resolved.twitchLogin, input.kind || 'manual');"
    );
  }

  return source;
});
