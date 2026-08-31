/**
 * The owner may address Athena loosely because their Twitch user ID is checked
 * before this matcher is used. Standalone "Athena" may appear anywhere, while
 * similarly named accounts such as "athena1234" are ignored.
 */
export function isOwnerAthenaInvocation(message: string, botUsername = 'athenabot87'): boolean {
  const normalized = String(message || '').trim();
  const botMention = buildBotMentionPattern(botUsername);
  return /\bathena\b/i.test(normalized) || botMention.test(normalized);
}

/**
 * Every non-owner must begin the message with Athena's complete Twitch
 * username. This matcher is used only after the active visitor channel and
 * ten-minute owner window are checked.
 */
export function isVisitorAthenaInvocation(message: string, botUsername = 'athenabot87'): boolean {
  const normalized = String(message || '').trim();
  return buildBotMentionPattern(botUsername, true).test(normalized);
}

function buildBotMentionPattern(botUsername: string, anchored = false): RegExp {
  const normalized = String(botUsername || '').trim().toLowerCase().replace(/^@/, '');
  const safeUsername = normalized.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&') || 'athenabot87';
  return new RegExp(`${anchored ? '^' : ''}@${safeUsername}\\b`, 'i');
}
