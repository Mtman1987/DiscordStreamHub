const DISCORD_CHAT_STRING_FIELDS = [
  'userId',
  'guildId',
  'message',
  'dispatch',
  'userName',
  'channelId',
  'messageId',
  'userAvatar',
];

function escapeControlCharactersInsideStrings(source: string) {
  let output = '';
  let inString = false;
  let escaped = false;

  for (const char of source) {
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      output += char;
      inString = false;
      continue;
    }

    if (char === '\n') output += '\\n';
    else if (char === '\r') output += '\\r';
    else if (char === '\t') output += '\\t';
    else if (char < ' ' || char === '\u007F') output += ' ';
    else output += char;
  }

  return output;
}

function extractJsonStringField(source: string, key: string, nextKeys: string[] = []) {
  const simple = source.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 's'))?.[1];
  if (simple !== undefined) return simple;

  const marker = `"${key}"`;
  const keyIndex = source.indexOf(marker);
  if (keyIndex < 0) return '';
  const colonIndex = source.indexOf(':', keyIndex + marker.length);
  if (colonIndex < 0) return '';
  const firstQuoteIndex = source.indexOf('"', colonIndex + 1);
  if (firstQuoteIndex < 0) return '';

  let endIndex = -1;
  for (const nextKey of nextKeys) {
    const nextMarker = new RegExp(`"\\s*,\\s*"${nextKey}"\\s*:`, 's');
    const match = nextMarker.exec(source.slice(firstQuoteIndex + 1));
    if (match?.index !== undefined) {
      const candidate = firstQuoteIndex + 1 + match.index;
      if (endIndex < 0 || candidate < endIndex) endIndex = candidate;
    }
  }

  if (endIndex < 0) return '';
  return source.slice(firstQuoteIndex + 1, endIndex);
}

function isDirectMessagePayload(data: any): boolean {
  const guildId = data?.guildId || data?.guild_id || data?.guild?.id || '';
  const channelType = data?.channelType ?? data?.channel_type ?? data?.channel?.type ?? '';
  return Boolean(
    data?.isDM ||
    data?.isDirectMessage ||
    data?.is_direct_message ||
    channelType === 'DM' ||
    channelType === 1 ||
    channelType === '1' ||
    !guildId
  );
}

function normalizeSpmtCommandTypos(command: string): string {
  return command
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(?:sttus|staus|stauts|statsu|statuz)\b/g, 'status')
    .replace(/\b(?:liv|lve)\b/g, 'live');
}

function rewritePrivateSpmtCommand(message: string): string | null {
  const match = String(message || '').trim().match(/^@?spmt(?:\s+|[:,-]\s*)(.+)$/i);
  if (!match) return null;

  const originalCommand = match[1].trim().replace(/^!+/, '');
  const command = normalizeSpmtCommandTypos(originalCommand);
  if (/^(?:status|state|game status|chat[\s-]?tag status)$/.test(command)) {
    return 'Athena, show me the Chat Tag status.';
  }
  if (/^(?:current|tag|who(?:'?s| is) it|who has the tag)$/.test(command)) {
    return 'Athena, who is currently IT in Chat Tag?';
  }
  if (/^(?:leader|leaderboard|rankings?|top(?:\s+(?:3|three))?)$/.test(command)) {
    return 'Athena, show me the Chat Tag leaderboard.';
  }
  if (/^(?:live|who(?:'?s| is) live|streamers?|members live)$/.test(command)) {
    return 'Athena, how many Chat Tag users are live right now?';
  }
  if (/^(?:apps?|tools?|catalog)$/.test(command)) {
    return 'Athena, show me the SpaceMountain app catalog.';
  }
  if (/^(?:hearmeout|hear me out|music|now playing|queue)$/.test(command)) {
    return 'Athena, what is playing in HearMeOut?';
  }
  if (/^(?:help|commands?|command list)$/.test(command)) {
    return 'Athena, show me the private command help.';
  }

  // Unknown SPMT namespace entries are explicit commands, not conversation.
  // Reuse the existing native command dispatcher by converting them to !commands.
  return originalCommand ? `!${originalCommand}` : null;
}

export function normalizeDiscordDmSpmtCommand(payload: any): any {
  const data = payload?.root || payload || {};
  if (!isDirectMessagePayload(data)) return payload;

  const originalMessage = String(data.message || data.content || '').trim();
  const rewrittenMessage = rewritePrivateSpmtCommand(originalMessage);
  if (!rewrittenMessage || rewrittenMessage === originalMessage) return payload;

  const nextData = {
    ...data,
    message: rewrittenMessage,
    content: rewrittenMessage,
    originalSpmtMessage: originalMessage,
  };
  return payload?.root
    ? { ...payload, root: nextData }
    : { ...payload, ...nextData };
}

export function parseDiscordChatPayload(rawBody: string) {
  const raw = rawBody.trim();
  if (!raw) return {};

  try {
    return normalizeDiscordDmSpmtCommand(JSON.parse(raw));
  } catch {}

  const escapedControls = escapeControlCharactersInsideStrings(raw);
  try {
    return normalizeDiscordDmSpmtCommand(JSON.parse(escapedControls));
  } catch {}

  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '');
  try {
    return normalizeDiscordDmSpmtCommand(JSON.parse(cleaned));
  } catch (parseError) {
    const salvaged = {
      userId: extractJsonStringField(raw, 'userId', DISCORD_CHAT_STRING_FIELDS.filter((key) => key !== 'userId')),
      guildId: extractJsonStringField(raw, 'guildId', DISCORD_CHAT_STRING_FIELDS.filter((key) => !['userId', 'guildId'].includes(key))),
      message: extractJsonStringField(raw, 'message', DISCORD_CHAT_STRING_FIELDS.filter((key) => !['userId', 'guildId', 'message'].includes(key))),
      userName: extractJsonStringField(raw, 'userName', ['channelId', 'messageId', 'userAvatar']),
      channelId: extractJsonStringField(raw, 'channelId', ['messageId', 'userAvatar']),
      messageId: extractJsonStringField(raw, 'messageId', ['userAvatar']),
      userAvatar: extractJsonStringField(raw, 'userAvatar', []),
    };

    if (salvaged.message && salvaged.channelId) {
      console.warn('[DiscordChat] Salvaged malformed JSON payload', {
        keys: Object.keys(salvaged).filter((key) => Boolean((salvaged as any)[key])),
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return normalizeDiscordDmSpmtCommand(salvaged);
    }

    console.warn('[DiscordChat] Invalid JSON payload', {
      preview: raw.slice(0, 500),
      error: parseError instanceof Error ? parseError.message : String(parseError),
    });
    return null;
  }
}
