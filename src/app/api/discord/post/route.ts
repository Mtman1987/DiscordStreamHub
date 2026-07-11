'use server';

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { channelId, content, embeds, components, imageUrl } = await request.json();

    if (!channelId) {
      return NextResponse.json(
        { error: 'Channel ID is required' },
        { status: 400 }
      );
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json(
        { error: 'Bot token not configured on the server.' },
        { status: 500 }
      );
    }

    const discordApiEndpoint = `https://discord.com/api/v10/channels/${channelId}/messages`;

    const payload: any = {};
    if (content) payload.content = content;
    if (embeds) payload.embeds = embeds;
    if (components) payload.components = components;
    if (!content && !embeds && !imageUrl) payload.content = 'Hello from Discord Stream Hub. The bot is connected.';

    // If an imageUrl is supplied, fetch it and send as a file attachment so Discord will render
    // the image reliably in the embed (use attachment://filename).
    let response;
    if (imageUrl) {
      try {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) {
          throw new Error(`Failed to fetch image: ${imgRes.status}`);
        }
        const arrayBuffer = await imgRes.arrayBuffer();
        const contentType = imgRes.headers.get('content-type') || 'application/octet-stream';
        const ext = contentType.includes('gif') ? 'gif' : contentType.includes('png') ? 'png' : 'jpg';
        const filename = `attachment.${ext}`;

        // Ensure embed references the attachment
        if (!payload.embeds || payload.embeds.length === 0) payload.embeds = [];
        if (!payload.embeds[0]) payload.embeds[0] = {};
        payload.embeds[0].image = { url: `attachment://${filename}` };

        const form = new FormData();
        form.append('payload_json', JSON.stringify(payload));
        // In Node/Next server, Blob should be available. Use it to wrap the ArrayBuffer.
        const blob = new Blob([arrayBuffer], { type: contentType });
        // Discord expects files[] fields; use files[0]
        form.append('files[0]', blob, filename as any);

        response = await fetch(discordApiEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${botToken}`,
          },
          body: form as any,
        });
      } catch (err: any) {
        console.error('[API/POST] Image attach failed, falling back to JSON post:', err?.message || err);
        // fallback to JSON post below
      }
    }

    if (!response) {
      response = await fetch(discordApiEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[API/POST] Discord API Error: ${response.status}`,
        errorText
      );
      return NextResponse.json(
        { error: `Failed to send message: ${errorText}` },
        { status: response.status }
      );
    }

    const responseData = await response.json();
    return NextResponse.json({ success: true, messageId: responseData.id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'An unknown error occurred.';
    console.error('[API/POST] Internal Server Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
