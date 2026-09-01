import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('nuke channel settings has a real JSON API route', async () => {
  const route = await source('src/app/api/nuke-channel/route.ts');
  assert.match(route, /export async function POST/);
  assert.match(route, /NextResponse\.json/);
  assert.match(route, /\/messages\/bulk-delete/);
  assert.match(route, /mode === 'until'/);
  assert.match(route, /author\?\.id/);
  assert.match(route, /getHardcodedGuildId/);
});

test('browser database writes fail loudly instead of reporting false success', async () => {
  const hook = await source('src/hooks/use-db.ts');
  assert.match(hook, /async function readJsonResponse/);
  assert.match(hook, /if \(!response\.ok\)/);
  assert.match(hook, /await readJsonResponse\(response, `Update \$\{path\}`\)/);
  assert.match(hook, /await readJsonResponse\(response, `Write \$\{path\}`\)/);
  assert.match(hook, /await readJsonResponse\(response, `Delete \$\{path\}`\)/);

  const updateCheck = hook.indexOf('await readJsonResponse(response, `Update ${path}`)');
  const updateEvent = hook.indexOf("window.dispatchEvent(new CustomEvent('dsh-db-updated'", updateCheck);
  assert.ok(updateCheck >= 0 && updateEvent > updateCheck, 'update event must happen only after the write response is verified');
});
