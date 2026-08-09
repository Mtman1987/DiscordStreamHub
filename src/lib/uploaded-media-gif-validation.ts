export const MAX_STREAMWEAVER_MEDIA_BYTES = 60 * 1024 * 1024;
const ALLOWED_SLOTS = new Set(['avatar-idle', 'avatar-talking', 'private-dm', 'public-discord']);

export function validateUploadedGifConversion(input: {
  tenantId: string;
  slot: string;
  fileName: string;
  mimeType: string;
  size: number;
}): string | null {
  if (!String(input.tenantId || '').trim()) return 'tenantId is required.';
  if (!ALLOWED_SLOTS.has(input.slot)) return 'Unsupported StreamWeaver media slot.';
  const mp4Named = input.fileName.toLowerCase().endsWith('.mp4');
  const mp4Mime = ['video/mp4', 'application/mp4', 'application/octet-stream'].includes(input.mimeType.toLowerCase());
  if (!mp4Named || !mp4Mime) return 'Only MP4 uploads can be converted.';
  if (!Number.isFinite(input.size) || input.size <= 0) return 'The MP4 upload is empty.';
  if (input.size > MAX_STREAMWEAVER_MEDIA_BYTES) return 'MP4 uploads are limited to 60 MB.';
  return null;
}
