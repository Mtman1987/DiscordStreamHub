import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ingress = readFileSync(
  resolve(process.cwd(), 'src/app/api/discord/gateway-ingress/route.ts'),
  'utf8',
);

test('routes Signal bang commands to StreamWeaver without enabling generic bang fanout', () => {
  assert.match(ingress, /\^!signal\(\?:bot\)\?/);
  assert.match(
    ingress,
    /if \(isStreamweaverSignalCommand \|\| \(!isBangCommand && !isSpmtCommand\)\)/,
  );
  assert.match(ingress, /destination: 'streamweaver'/);
});
