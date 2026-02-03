import process from 'node:process';
import { TwitchService, type TwitchPointsEvent } from './twitch-service';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseEventArg(raw: string, fallbackServerId: string): TwitchPointsEvent {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Event payload must be an object.');
    }

    if (!parsed.eventType) {
      throw new Error('eventType is required.');
    }

    if (!parsed.userId) {
      throw new Error('userId is required.');
    }

    return {
      serverId: parsed.serverId ?? fallbackServerId,
      userId: parsed.userId,
      eventType: parsed.eventType,
      quantity: parsed.quantity ?? 1,
      metadata: parsed.metadata ?? {},
    };
  } catch (error) {
    throw new Error(
      `Failed to parse event JSON payload: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function bootstrap() {
  const clientId = requiredEnv('TWITCH_CLIENT_ID');
  const clientSecret = requiredEnv('TWITCH_CLIENT_SECRET');
  const serverId =
    process.env.POINTS_SERVER_ID ??
    process.env.HARDCODED_GUILD_ID ??
    (() => {
      throw new Error(
        'POINTS_SERVER_ID is required (fallback to HARDCODED_GUILD_ID if available).',
      );
    })();

  const baseUrl =
    process.env.POINTS_API_URL ??
    (() => {
      const fallback =
        process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
      return fallback ? `${fallback.replace(/\/$/, '')}/api/points/update` : null;
    })() ??
    'http://localhost:3000/api/points/update';

  const pointsApiUrl = baseUrl;
  const pointsServiceSecret = process.env.POINTS_SERVICE_SECRET;

  const service = new TwitchService({
    clientId,
    clientSecret,
    pointsApiUrl,
    pointsServiceSecret,
    logger: console,
  });

  await service.ensureAppAccessToken();

  const args = process.argv.slice(2);
  const eventArgIndex = args.indexOf('--event');

  if (eventArgIndex !== -1) {
    const raw = args[eventArgIndex + 1];
    if (!raw) {
      throw new Error(
        '--event flag requires a JSON payload as the next argument.',
      );
    }

    const event = parseEventArg(raw, serverId);
    const points = await service.handleEvent(event);
    console.log(
      `[startup] Awarded ${points} points to ${event.userId} via one-off event.`,
    );
    return;
  }

  if (process.env.MOCK_TWITCH_EVENTS === '1') {
    const mockUsers =
      process.env.MOCK_TWITCH_USER_IDS?.split(',').map((id) => id.trim()) ??
      [];
    if (!mockUsers.length) {
      throw new Error(
        'MOCK_TWITCH_EVENTS enabled but MOCK_TWITCH_USER_IDS is empty.',
      );
    }

    const sampleEvents: TwitchPointsEvent[] = [
      { serverId, userId: mockUsers[0], eventType: 'follow' },
      {
        serverId,
        userId: mockUsers[0],
        eventType: 'chat_activity',
        metadata: { messageCount: 5 },
        quantity: 5,
      },
    ];

    if (mockUsers[1]) {
      sampleEvents.push({
        serverId,
        userId: mockUsers[1],
        eventType: 'subscription',
      });
      sampleEvents.push({
        serverId,
        userId: mockUsers[1],
        eventType: 'gifted_subscription',
        quantity: 3,
      });
    }

    const interval =
      Number.parseInt(process.env.MOCK_TWITCH_INTERVAL_MS ?? '15000', 10) ||
      15000;
    const stop = service.startMockEventLoop(sampleEvents, interval);

    process.on('SIGINT', () => {
      stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      stop();
      process.exit(0);
    });

    console.log('[startup] Mock Twitch event loop is running.');
    return;
  }

  console.log(
    '[startup] Twitch service initialised. Use --event to forward events or enable MOCK_TWITCH_EVENTS.',
  );
}

bootstrap().catch((error) => {
  console.error('[startup] Unhandled error:', error);
  process.exit(1);
});
