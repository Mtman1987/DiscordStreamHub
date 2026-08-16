import assert from 'node:assert/strict';
import test from 'node:test';
import { humanizeDiscordText } from '../src/lib/discord-human-text';

test('resolves Discord users channels roles and custom emoji without leaking ids', () => {
  const text = humanizeDiscordText(
    'hey <@1416041303707353119> in <#1532235742951116890> ask <@&1476540488147533895> <:party_duck:1463633163673927732>',
    {
      users: { '1416041303707353119': 'Loves Nightmare' },
      channels: { '1532235742951116890': 'general' },
      roles: { '1476540488147533895': 'Moderators' },
    },
  );
  assert.equal(text, 'hey @Loves Nightmare in #general ask @Moderators :party_duck:');
  assert.doesNotMatch(text, /\d{10,}/);
  assert.doesNotMatch(text, /<[@#:]/);
});

test('unknown Discord references degrade to readable labels instead of snowflakes', () => {
  const text = humanizeDiscordText('<@1416041303707353119> <#1532235742951116890> <@&1476540488147533895>');
  assert.equal(text, '@Discord user #Discord channel @Discord role');
  assert.doesNotMatch(text, /\d{10,}/);
});
