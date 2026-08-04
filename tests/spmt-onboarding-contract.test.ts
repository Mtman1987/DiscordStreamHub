import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildSpmtOnboardingButton,
  SPMT_ONBOARDING_CUSTOM_ID,
  SPMT_ONBOARDING_LABEL,
} from '../src/lib/spmt-onboarding-contract';
import { buildSpmtWelcomeEmbed } from '../src/lib/spmt-onboarding-embed';

test('uses one verified SPMT onboarding button contract everywhere', () => {
  assert.deepEqual(buildSpmtOnboardingButton(), {
    type: 2,
    style: 3,
    label: 'Join or Recover SPMT with Twitch',
    custom_id: 'spmt_join_recover',
    emoji: { name: '🚀' },
  });
  assert.equal(SPMT_ONBOARDING_CUSTOM_ID, 'spmt_join_recover');
  assert.equal(SPMT_ONBOARDING_LABEL, 'Join or Recover SPMT with Twitch');
});

test('both persistent spotlight embeds use the shared button and replacement path', () => {
  const automaticSpotlight = readFileSync('src/lib/community-spotlight-service.ts', 'utf8');
  const polling = readFileSync('src/lib/twitch-polling-service.ts', 'utf8');
  const settingsDispatch = readFileSync('src/app/api/discord/dispatch-embed/route.ts', 'utf8');
  const managedMessageSources = [automaticSpotlight, polling, settingsDispatch].join('\n');

  assert.match(automaticSpotlight, /buildSpmtOnboardingButton\(\)/);
  assert.match(settingsDispatch, /buildSpmtOnboardingButton\(\)/);
  assert.match(polling, /buildSpmtOnboardingButton\(\)/);
  assert.match(settingsDispatch, /buildSpmtWelcomeEmbed\(/);
  assert.match(polling, /buildSpmtWelcomeEmbed\(/);
  assert.match(polling, /replacementMessageId = await postDiscordMessage/);
  assert.match(polling, /messageId: replacementMessageId/);
  assert.match(polling, /collection\('config'\)\.doc\('linkingEmbed'\)\.set/);
  assert.doesNotMatch(polling, /Linking embed unavailable; clearing stale config/);
  assert.doesNotMatch(managedMessageSources, /Link Twitch Username/);
  assert.doesNotMatch(managedMessageSources, /custom_id:\s*['"]link_twitch_account['"]/);
  assert.doesNotMatch(managedMessageSources, /custom_id:\s*['"]spmt_onboard['"]/);
});

test('welcome wording survives refresh because dispatch and polling use one builder', () => {
  const embed = buildSpmtWelcomeEmbed({
    serverName: 'Space Mountain',
    username: 'Captain',
    twitchLogin: 'captain',
    avatarUrl: 'https://example.test/avatar.png',
    spotlightGif: 'https://example.test/spotlight.gif',
  }) as any;

  assert.equal(embed.title, '🚀 WELCOME ABOARD, CAPTAIN');
  assert.match(embed.description, /one connected crew across Discord, Twitch, streams, apps, events, XP, and creator rewards/);
  assert.match(embed.description, /find or create your identity/);
  assert.match(embed.description, /claiming or recovering your account/);
  assert.match(embed.description, /One crew\. One identity\. An entire ecosystem\./);
  assert.equal(embed.author.url, 'https://twitch.tv/captain');
});

test('HearMeOut controls forward verified Discord admin status instead of elevating everyone', () => {
  const interactions = readFileSync('src/app/api/discord/interactions/route.ts', 'utf8');
  assert.match(interactions, /params\.set\('isAdmin', actor\?\.isAdmin === true \? 'true' : 'false'\)/);
  assert.doesNotMatch(interactions, /params\.set\('isAdmin', 'true'\)/);
});

test('Twitch OAuth persists refreshable credentials without returning them to callers', () => {
  const callback = readFileSync('src/app/api/twitch/oauth/callback/route.ts', 'utf8');
  assert.match(callback, /credentialsStored:\s*true/);
  assert.doesNotMatch(callback, /tokens:\s*\{\s*accessToken:\s*tokenData\.access_token/);
});
