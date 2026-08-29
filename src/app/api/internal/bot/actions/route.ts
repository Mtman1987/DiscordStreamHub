import { NextRequest, NextResponse } from 'next/server';
import { DSH_BOT_ACTIONS, executeDshBotAction, type DshBotActionId } from '@/lib/bot-action-service';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

export const dynamic = 'force-dynamic';

const ACTIONS = new Set<DshBotActionId>(DSH_BOT_ACTIONS);

export async function POST(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as any;
  const action = String(body?.action || '') as DshBotActionId;
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: 'Unknown DiscordStreamHub bot action' }, { status: 400 });
  }

  try {
    const result = await executeDshBotAction({ ...body, action });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /not found/i.test(message) ? 404 : /required|invalid|already claimed/i.test(message) ? 400 : 500;
    if (status >= 500) console.error(`[InternalBotAction] ${action} failed:`, error);
    return NextResponse.json({ error: message, action }, { status });
  }
}
