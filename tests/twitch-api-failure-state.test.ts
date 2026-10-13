import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('Twitch stream polling propagates API failures instead of reporting everyone offline', () => {
  const source = fs.readFileSync('src/lib/twitch-api-service.ts', 'utf8');
  const start = source.indexOf('async getStreamsByLogins(');
  const end = source.indexOf('\n  async getRandomClipFromOnlineUsers(', start);
  assert.notEqual(start, -1, 'getStreamsByLogins method exists');
  assert.notEqual(end, -1, 'method boundary exists');
  const method = source.slice(start, end);
  assert.match(method, /Error fetching streams by logins; preserving last known stream state/);
  assert.match(method, /catch \(error\)[\s\S]*?throw error;/);
  assert.doesNotMatch(method, /catch \(error\)[\s\S]*?return streamMap;/);
});

test('Twitch app-token failures use credential-aware backoff to avoid repeated auth-error spam', () => {
  const source = fs.readFileSync('src/lib/twitch-api-service.ts', 'utf8');
  assert.match(source, /INVALID_CREDENTIAL_BACKOFF_MS = 12 \* 60 \* 60 \* 1000/);
  assert.match(source, /TRANSIENT_TOKEN_BACKOFF_MS = 60 \* 1000/);
  assert.match(source, /tokenFailureFingerprint/);
  assert.match(source, /Twitch rejected the configured app credentials; token requests paused for 12 hours or until credentials change/);
  assert.match(source, /App-token request is in backoff/);
  assert.match(source, /if \(!this\.clientId \|\| !this\.clientSecret\)/);
});

test('Twitch polling initialization remains retryable after a failed startup query', () => {
  const source = fs.readFileSync('src/lib/twitch-polling-service.ts', 'utf8');
  const start = source.indexOf('async initialize(): Promise<void>');
  const end = source.indexOf('private async initializePolling(): Promise<void>', start);
  assert.notEqual(start, -1, 'initialize method exists');
  assert.notEqual(end, -1, 'initializePolling boundary exists');
  const initialize = source.slice(start, end);
  assert.match(initialize, /await this\.initializePolling\(\);[\s\S]*?this\.initialized = true;/);
  assert.match(initialize, /catch \(error\)[\s\S]*?this\.initialized = false;[\s\S]*?throw error;/);
});

test('Twitch app-token refresh is shared across concurrent API callers', () => {
  const source = fs.readFileSync('src/lib/twitch-api-service.ts', 'utf8');
  assert.match(source, /private accessTokenRequest: Promise<string> \| null = null/);
  assert.match(source, /if \(this\.accessTokenRequest\) \{[\s\S]*?return this\.accessTokenRequest;/);
  assert.match(source, /this\.requestAccessToken\(credentialFingerprint\)/);
  assert.match(source, /finally \{[\s\S]*?if \(this\.accessTokenRequest === request\)[\s\S]*?this\.accessTokenRequest = null;/);
});

test('Twitch status checks do not fan out or return partial offline results on auth and service failures', () => {
  const source = fs.readFileSync('src/lib/twitch-api-service.ts', 'utf8');
  const start = source.indexOf('async checkMultipleStreamsStatus(');
  const end = source.indexOf('\n  }\n}', start);
  assert.notEqual(start, -1, 'checkMultipleStreamsStatus method exists');
  assert.notEqual(end, -1, 'method boundary exists');
  const method = source.slice(start, end);
  assert.match(method, /Twitch API error: 400/);
  assert.match(method, /if \(!isBadRequest\) \{\s*throw error;/);
  assert.match(method, /Stream status check failed; returning the error instead of partial\/offline results/);
  assert.match(method, /throw error;/);
});
