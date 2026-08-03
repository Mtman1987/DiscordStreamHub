import assert from 'node:assert/strict';
import test from 'node:test';
import { isExplicitAthenaInvocation } from '../src/lib/athena-visitor-gate';

test('accepts unmistakable Athena invocations', () => {
  assert.equal(isExplicitAthenaInvocation('Athena can you help?'), true);
  assert.equal(isExplicitAthenaInvocation('Hey Athena, what do you think?'), true);
  assert.equal(isExplicitAthenaInvocation('!athena tell me a joke'), true);
  assert.equal(isExplicitAthenaInvocation('@athenabot87 hello'), true);
});

test('ignores conversation about Athena and similarly named viewers', () => {
  assert.equal(isExplicitAthenaInvocation("where's Athena?"), false);
  assert.equal(isExplicitAthenaInvocation('hi Athena'), false);
  assert.equal(isExplicitAthenaInvocation('hello athena1234'), false);
  assert.equal(isExplicitAthenaInvocation('Athena1234 said hello'), false);
  assert.equal(isExplicitAthenaInvocation('the Athena bot is neat'), false);
});
