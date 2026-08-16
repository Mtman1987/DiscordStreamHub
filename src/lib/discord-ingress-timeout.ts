export const DISCORD_INGRESS_PASSIVE_TIMEOUT_MS = 12_000;
export const DISCORD_INGRESS_COMMAND_TIMEOUT_MS = 55_000;

export function getDiscordIngressTimeoutMs(content: string, mentionsBot = false): number {
  const message = String(content || '').trim();
  const isCommand = mentionsBot || message.startsWith('!') || /^@?spmt(?:\s|$)/i.test(message);
  return isCommand ? DISCORD_INGRESS_COMMAND_TIMEOUT_MS : DISCORD_INGRESS_PASSIVE_TIMEOUT_MS;
}
