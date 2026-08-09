const DEFAULT_STREAMWEAVER_COMMAND_TIMEOUT_MS = 30_000;
const IMAGE_STREAMWEAVER_COMMAND_TIMEOUT_MS = 180_000;

export function getStreamweaverCommandTimeoutMs(message: unknown): number {
  const command = String(message || '').trim();
  return /^!img(?:\s|$)/i.test(command)
    ? IMAGE_STREAMWEAVER_COMMAND_TIMEOUT_MS
    : DEFAULT_STREAMWEAVER_COMMAND_TIMEOUT_MS;
}
