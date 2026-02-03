import EventEmitter from 'events';

export type TwitchPointsEventType =
  | 'raid'
  | 'follow'
  | 'subscription'
  | 'gifted_subscription'
  | 'bits'
  | 'chat_activity';

export interface TwitchPointsEvent {
  serverId: string;
  userId: string;
  eventType: TwitchPointsEventType;
  quantity?: number;
  metadata?: Record<string, unknown>;
}

export interface TwitchServiceConfig {
  clientId: string;
  clientSecret: string;
  /**
   * REST endpoint exposed by the Next.js app, e.g. http://localhost:3000/api/points/update
   */
  pointsApiUrl: string;
  /**
   * Value for the `x-service-secret` header expected by the API route.
   */
  pointsServiceSecret?: string;
  /**
   * Optional logger; defaults to console.
   */
  logger?: Pick<Console, 'log' | 'error' | 'warn'>;
}

interface AccessTokenState {
  token: string;
  expiresAt: number;
}

/**
 * Lightweight helper that manages Twitch authentication and forwards events
 * to the points API. This class does not open sockets on its own; instead,
 * higher-level code is expected to call {@link handleEvent} whenever an event
 * is received (via EventSub, tmi.js, etc.).
 */
export class TwitchService extends EventEmitter {
  private readonly config: TwitchServiceConfig;
  private accessTokenState: AccessTokenState | null = null;

  constructor(config: TwitchServiceConfig) {
    super();
    this.config = config;
  }

  /**
   * Acquire (or reuse) an app access token for the Twitch API using the
   * Client Credentials flow.
   */
  async ensureAppAccessToken(): Promise<string> {
    const now = Date.now();
    if (
      this.accessTokenState &&
      this.accessTokenState.expiresAt - 30_000 > now
    ) {
      return this.accessTokenState.token;
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'client_credentials',
    });

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logError(
        `Failed to obtain Twitch access token: ${response.status} ${errorText}`,
      );
      throw new Error('Unable to obtain Twitch access token.');
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    this.accessTokenState = {
      token: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };

    this.log(`Fetched new Twitch access token (expires in ${data.expires_in}s)`);
    return data.access_token;
  }

  /**
   * Forward an event to the points API. Returns the awarded points.
   */
  async handleEvent(event: TwitchPointsEvent): Promise<number> {
    const url = this.config.pointsApiUrl;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.pointsServiceSecret) {
      headers['x-service-secret'] = this.config.pointsServiceSecret;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        serverId: event.serverId,
        userId: event.userId,
        eventType: event.eventType,
        quantity: event.quantity ?? 1,
        source: 'twitch',
        metadata: event.metadata ?? {},
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.text();
      this.logError(
        `[TwitchService] Points API responded with ${response.status}: ${errorPayload}`,
      );
      throw new Error('Failed to post event to points API.');
    }

    const payload = (await response.json()) as {
      status: string;
      pointsAwarded?: number;
    };

    const awarded = payload.pointsAwarded ?? 0;
    this.log(
      `[TwitchService] Awarded ${awarded} points to ${event.userId} (${event.eventType})`,
    );
    this.emit('points-awarded', { ...event, pointsAwarded: awarded });
    return awarded;
  }

  /**
   * Utility helper for local development. Pass a list of sample events and the
   * service will cycle through them at the desired interval, allowing the rest
   * of the stack to be exercised without real Twitch traffic.
   */
  startMockEventLoop(
    events: TwitchPointsEvent[],
    intervalMs = 10_000,
  ): () => void {
    if (!events.length) {
      throw new Error('Mock loop requires at least one sample event.');
    }

    let index = 0;
    const timer = setInterval(() => {
      const current = events[index];
      this.handleEvent(current).catch((error) => {
        this.logError(`[TwitchService] Mock event failed`, error);
      });
      index = (index + 1) % events.length;
    }, intervalMs);

    this.log(
      `[TwitchService] Started mock loop with ${events.length} events (interval ${intervalMs}ms)`,
    );

    return () => {
      clearInterval(timer);
      this.log('[TwitchService] Stopped mock loop');
    };
  }

  private log(message: string) {
    (this.config.logger ?? console).log(message);
  }

  private logError(message: string, error?: unknown) {
    const target = this.config.logger ?? console;
    if (error) {
      target.error(message, error);
    } else {
      target.error(message);
    }
  }
}
