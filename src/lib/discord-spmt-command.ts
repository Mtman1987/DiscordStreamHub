export type PublicSpmtCommand = {
  matched: true;
  controls: boolean;
  originalMessage: string;
  forwardMessage?: string;
};

export function normalizePublicSpmtCommand(message: string, discordClientId = ''): PublicSpmtCommand | null {
  const originalMessage = String(message || '').trim();
  if (!originalMessage) return null;

  let remainder = '';
  const botMention = discordClientId
    ? [`<@${discordClientId}>`, `<@!${discordClientId}>`]
        .find((prefix) => originalMessage.startsWith(prefix))
    : undefined;

  if (botMention) {
    remainder = originalMessage.slice(botMention.length).trim();
  } else {
    const match = originalMessage.match(/^@?spmt(?:\s+|$)(.*)$/i);
    if (!match) return null;
    remainder = String(match[1] || '').trim();
  }

  if (!remainder) {
    return { matched: true, controls: false, originalMessage, forwardMessage: '!commands' };
  }

  const lower = remainder.toLowerCase();
  if (lower === 'control' || lower === 'controls') {
    return { matched: true, controls: true, originalMessage };
  }

  // `spmt pack` is a Quackverse/ChatTag command. Do not translate it to the
  // StreamWeaver `!pack` command, which opens a Pokemon booster instead.
  // The gateway already delivers the original SPMT message to ChatTag.
  if (lower === 'pack') {
    return { matched: true, controls: false, originalMessage };
  }

  if (['status', 'sttus', 'stats'].includes(lower)) {
    return {
      matched: true,
      controls: false,
      originalMessage,
      forwardMessage: 'Athena, show me the Chat Tag status.',
    };
  }
  if (['live', 'online'].includes(lower)) {
    return {
      matched: true,
      controls: false,
      originalMessage,
      forwardMessage: 'Athena, how many Chat Tag users are live right now?',
    };
  }

  const command = remainder.replace(/^!+/, '').trim();
  return {
    matched: true,
    controls: false,
    originalMessage,
    forwardMessage: command ? `!${command}` : '!commands',
  };
}
