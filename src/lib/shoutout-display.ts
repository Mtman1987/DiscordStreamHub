import { formatDistanceToNowStrict } from 'date-fns';
import type { UserProfile } from './types';

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function deriveStreamStats(streamer: UserProfile) {
  const viewerCount = streamer.lastTwitchData?.viewerCount ?? null;
  const gameTitle =
    streamer.lastTwitchData?.gameTitle ||
    streamer.topic ||
    (streamer.group === 'VIP' ? 'VIP Mission' : 'Community Mission');
  const updatedAt = toDate(streamer.lastTwitchData?.updatedAt);
  const updatedLabel = updatedAt
    ? formatDistanceToNowStrict(updatedAt, { addSuffix: true })
    : null;

  return {
    viewerCount,
    gameTitle,
    updatedLabel,
  };
}

export function getMediaPreviewUrl(streamer: UserProfile): string {
  const shoutout = streamer.dailyShoutout;
  if (shoutout) {
    if (typeof shoutout.content === 'string' && shoutout.content.startsWith('http')) {
      return shoutout.content;
    }
    // Prioritize large image over thumbnail
    const embedImage = shoutout.embeds?.[0]?.image?.url;
    if (embedImage) {
      return embedImage;
    }
    // Only use thumbnail if no large image exists
    const embedThumbnail = shoutout.embeds?.[0]?.thumbnail?.url;
    if (embedThumbnail && !embedThumbnail.includes('profile_image')) {
      return embedThumbnail;
    }
  }
  return streamer.avatarUrl;
}
