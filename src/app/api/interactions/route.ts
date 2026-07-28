import type { NextRequest } from 'next/server';
import { POST as postCanonicalDiscordInteraction } from '@/app/api/discord/interactions/route';

// Compatibility endpoint for Discord applications that still target
// /api/interactions. Keep the path stable while one canonical implementation
// handles signature verification and every interaction family.
export function POST(request: NextRequest) {
  console.info('[RouteTelemetry]', JSON.stringify({
    kind: 'legacy-route',
    route: '/api/interactions',
    method: request.method,
    at: new Date().toISOString(),
  }));
  return postCanonicalDiscordInteraction(request);
}
