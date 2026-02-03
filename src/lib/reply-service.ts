'use server'

interface ReplyPayload {
  channelId: string
  replyText: string
  replierName: string
  originalAuthorName: string
  forwardedMessageId?: string
}

/**
 * Posts a reply to a message in a Discord channel using the bot token.
 */
export async function replyToMessage({
  channelId,
  replyText,
  replierName,
  originalAuthorName,
  forwardedMessageId,
}: ReplyPayload): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken) {
    throw new Error('DISCORD_BOT_TOKEN is not configured.')
  }

  const discordApiEndpoint = `https://discord.com/api/v10/channels/${channelId}/messages`
  const content = [
    `**${replierName}** replied to **${originalAuthorName}**:`,
    replyText,
  ].join('\n')

  const body: Record<string, unknown> = {
    content,
    allowed_mentions: { parse: [] },
  }

  if (forwardedMessageId) {
    body.message_reference = {
      message_id: forwardedMessageId,
      channel_id: channelId,
    }
  }

  const response = await fetch(discordApiEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to send reply to Discord: ${response.status} ${errorText}`)
  }
}
