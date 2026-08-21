import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string) {
  return readFileSync(path, 'utf8');
}

test('ChatGPT fallback requires the existing mtman Discord approval boundary', () => {
  const dm = source('src/lib/owner-dm-service.ts');
  const ingress = source('scripts/discord-ingress-bot.ts');
  const route = source('src/app/api/internal/mtfixit/decision/route.ts');
  const orchestrator = source('src/lib/mtfixit-orchestrator.ts');

  assert.match(dm, /\(\?:mtfixit\|chatgpt\)_\(\?:approve\|deny\)/);
  assert.match(ingress, /REPAIR_DECISION = \/\^\(mtfixit\|chatgpt\)_\(approve\|deny\)/);
  assert.match(ingress, /JSON\.stringify\(\{ userId: interaction\.user\.id, jobId, action, kind \}\)/);
  assert.match(route, /Only mtman can approve MtFixIt deployment/);
  assert.match(route, /kind === 'chatgpt'/);
  assert.match(route, /decideChatGptHandoff\(jobId, action\)/);
  assert.match(orchestrator, /awaiting-chatgpt:\(chatgpt-/);
  assert.match(orchestrator, /Approve ChatGPT Repair/);
  assert.match(orchestrator, /chatgpt_approve:/);
  assert.match(orchestrator, /chatgpt_deny:/);
});
