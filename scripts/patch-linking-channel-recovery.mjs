import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src', 'lib', 'twitch-polling-service.ts');
const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
let source = original;

const bindingTarget = `      const { messageId, channelId } = linkingDoc.data()!;\n      if (!messageId || !channelId) {\n        return;\n      }`;
const bindingReplacement = `      const { messageId, channelId, channelName } = linkingDoc.data()!;\n      if (!messageId || !channelId) {\n        return;\n      }\n\n      // The guild channel list was refreshed at the start of this poll. If the\n      // saved linking channel was deleted/recreated, move the embed to a safe\n      // same-name replacement instead of retrying a dead Discord channel ID.\n      const { getChannels } = await import('./discord-sync-service');\n      const currentChannels = await getChannels(serverId);\n      let effectiveChannelId = channelId;\n      let effectiveChannelName = String(channelName || '').trim();\n      const savedChannelStillExists = currentChannels.some((candidate: any) => candidate?.id === channelId && candidate?.type === 0);\n      if (!savedChannelStillExists) {\n        if (!effectiveChannelName) {\n          const staleChannelDoc = await db.collection('servers').doc(serverId).collection('channels').doc(channelId).get();\n          effectiveChannelName = String(staleChannelDoc.data()?.name || '').trim();\n        }\n        const replacement = effectiveChannelName\n          ? currentChannels.find((candidate: any) => candidate?.type === 0 && candidate?.name === effectiveChannelName)\n          : null;\n        if (!replacement?.id) {\n          await linkingDoc.ref.set({\n            messageId: null,\n            channelId: null,\n            channelName: effectiveChannelName || null,\n            needsDispatch: true,\n            staleChannelId: channelId,\n            staleMessageId: messageId,\n            invalidatedAt: new Date().toISOString(),\n          }, { merge: true });\n          console.warn(\`[TwitchPolling] Linking embed channel ${'${channelId}'} no longer exists; cleared stale reference and waiting for redispatch\`);\n          return;\n        }\n        effectiveChannelId = replacement.id;\n        effectiveChannelName = replacement.name || effectiveChannelName;\n        console.log(\`[TwitchPolling] Linking embed channel recovered ${'${channelId}'} -> ${'${effectiveChannelId}'} (#${'${effectiveChannelName}'})\`);\n      }`;

if (!source.includes('savedChannelStillExists')) {
  if (!source.includes(bindingTarget)) {
    throw new Error('Linking embed recovery binding target was not found.');
  }
  source = source.replace(bindingTarget, bindingReplacement);
}

source = source.replace(
  'await editDiscordMessage(serverId, channelId, messageId, payload);',
  'await editDiscordMessage(serverId, effectiveChannelId, messageId, payload);',
);
source = source.replace(
  'const replacementMessageId = await postDiscordMessage(serverId, channelId, payload);',
  'const replacementMessageId = await postDiscordMessage(serverId, effectiveChannelId, payload);',
);
source = source.replace(
  '          channelId,\n          updatedAt: new Date().toISOString(),',
  '          channelId: effectiveChannelId,\n          channelName: effectiveChannelName || null,\n          needsDispatch: false,\n          updatedAt: new Date().toISOString(),',
);

for (const required of [
  'savedChannelStillExists',
  'staleChannelId: channelId',
  'needsDispatch: true',
  'effectiveChannelId',
  'postDiscordMessage(serverId, effectiveChannelId, payload)',
]) {
  if (!source.includes(required)) throw new Error(`Linking channel recovery patch missing ${required}`);
}

if (source !== original) fs.writeFileSync(file, source, 'utf8');
console.log('DSH linking embed channel recovery patch applied.');
