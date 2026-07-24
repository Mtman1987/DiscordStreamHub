import { NextResponse } from 'next/server';
import { twitchChatService } from '@/lib/twitch-chat-service';

export async function GET() {
  return NextResponse.json(twitchChatService.getStatus());
}
