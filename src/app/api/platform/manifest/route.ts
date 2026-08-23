import { NextResponse } from 'next/server';

const manifest = {
  manifestVersion: 'spmt.app-manifest/v1',
  id: 'discord-stream-hub',
  name: 'Discord Stream Hub',
  description: 'Discord community operations, Twitch shoutouts, events, moderation, clips, and cross-platform messaging.',
  version: '0.1.0',
  launchUrl: 'https://discord-stream-hub-new.fly.dev',
  healthUrl: 'https://discord-stream-hub-new.fly.dev/api/health',
  registrySource: 'first-party',
  capabilities: [
    'discord-community',
    'shoutouts',
    'calendar',
    'moderation',
    'signal',
    'clips',
    'messages',
    'points',
    'leaderboards',
  ],
  surfaces: ['dashboard', 'messages', 'calendar', 'leaderboard', 'settings'],
  integration: {
    identity: 'connected',
    events: 'connected',
    commlink: 'connected',
    athena: 'connected',
    workspace: 'connected',
    sdk: 'connected',
  },
  developer: {
    sdkPackage: '@spmt/sdk',
    eventOwner: 'discord-stream-hub',
    tenantIsolation: true,
    workers: [{ id: 'dsh-clip-worker', role: 'clip-processing' }],
  },
} as const;

export async function GET() {
  return NextResponse.json({
    ...manifest,
    buildSha: process.env.BUILD_SHA || 'development',
    generatedAt: new Date().toISOString(),
  });
}
