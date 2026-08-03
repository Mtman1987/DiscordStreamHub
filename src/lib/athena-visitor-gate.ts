/**
 * Athena must be addressed at the beginning of a message. This intentionally
 * ignores ordinary conversation such as "where's Athena?", "hi Athena", and
 * usernames such as "athena1234".
 */
export function isExplicitAthenaInvocation(message: string): boolean {
  const normalized = String(message || '').trim();
  return /^(?:!athena\b|@athenabot87\b|(?:hey\s+)?athena\b)/i.test(normalized);
}
