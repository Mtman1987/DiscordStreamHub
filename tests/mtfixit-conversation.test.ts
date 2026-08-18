import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

test('bare Discord mtfixit becomes a delete-and-edit conversation', () => {
  const route = source('src/app/api/discord/mtfixit/route.ts');
  const ingress = source('src/app/api/discord/gateway-ingress/route.ts');
  const delivery = source('src/lib/mtfixit-discord-delivery.ts');
  const pending = source('src/lib/mtfixit-conversation.ts');

  assert.match(route, /const PROMPT = 'Tell me the problem\.'/);
  assert.match(route, /deleteDiscordMtFixItMessage\(channelId, sourceMessageId\)/);
  assert.match(route, /beginPendingMtFixItConversation/);
  assert.match(route, /consumePendingMtFixItConversation/);
  assert.match(route, /editDiscordMtFixItMessage\(channelId, statusMessageId/);
  assert.doesNotMatch(route, /mtFixItPublicReply\('usage'\)/);

  assert.match(ingress, /getPendingMtFixItConversation/);
  assert.match(ingress, /isMtFixItCommand \|\| pendingMtFixIt/);
  assert.match(ingress, /dsh-mtfixit-followup/);

  assert.match(delivery, /method: 'DELETE'/);
  assert.match(delivery, /method: 'PATCH'/);
  assert.match(pending, /TTL_MS = 10 \* 60 \* 1000/);
});

test('MtFixIt Commlink diagnostics prefer scoped SPMT service OAuth', () => {
  const commlink = source('src/lib/mtfixit-commlink.ts');
  const token = source('src/lib/spmt-service-token.ts');

  assert.match(commlink, /getSpmtServiceToken\(\['athena:write'\]\)/);
  assert.match(commlink, /clearSpmtServiceTokenCache/);
  assert.match(token, /client_id: 'discord-stream-hub'/);
  assert.match(token, /grant_type: 'client_credentials'/);
});
