import { NextRequest, NextResponse } from 'next/server';
import { awardPoints, type PointsEventType } from '@/lib/points-service';

interface PointsUpdatePayload {
  serverId?: string;
  userId?: string;
  eventType?: PointsEventType;
  quantity?: number;
  source?: 'twitch' | 'discord' | 'manual';
  metadata?: Record<string, unknown>;
}

function jsonResponse(
  body: Record<string, unknown>,
  init?: ResponseInit,
): NextResponse {
  return NextResponse.json(body, init);
}

export async function POST(req: NextRequest) {
  const secret = process.env.POINTS_SERVICE_SECRET;
  if (secret) {
    const headerSecret = req.headers.get('x-service-secret');
    if (headerSecret !== secret) {
      return jsonResponse(
        { status: 'error', message: 'Unauthorized request.' },
        { status: 401 },
      );
    }
  }

  let payload: PointsUpdatePayload;
  try {
    payload = (await req.json()) as PointsUpdatePayload;
  } catch (error) {
    console.error('[points/update] Failed to parse JSON payload:', error);
    return jsonResponse(
      { status: 'error', message: 'Invalid JSON payload.' },
      { status: 400 },
    );
  }

  const { serverId, userId, eventType, quantity, source, metadata } = payload;

  if (!serverId || !userId || !eventType) {
    return jsonResponse(
      {
        status: 'error',
        message:
          'Missing required fields. Expecting `serverId`, `userId`, and `eventType`.',
      },
      { status: 400 },
    );
  }

  try {
    const result = await awardPoints({
      serverId,
      userId,
      eventType,
      quantity: typeof quantity === 'number' && quantity > 0 ? quantity : 1,
      source,
      metadata,
    });

    return jsonResponse(
      {
        status: 'success',
        pointsAwarded: result.pointsAwarded,
        settings: result.settingsSnapshot,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[points/update] Failed to award points:', error);
    const message =
      error instanceof Error ? error.message : 'Unknown server error';
    return jsonResponse(
      {
        status: 'error',
        message,
      },
      { status: 500 },
    );
  }
}
