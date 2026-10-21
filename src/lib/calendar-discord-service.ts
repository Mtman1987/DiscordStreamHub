import { postCalendarToDiscord } from './calendar-discord-service-new';

export {
  buildCalendarButtons,
  buildCalendarEmbed,
  refreshCalendarMessage,
  shiftCalendarMonth,
  storeCalendarMessageMeta,
} from './calendar-discord-service-new';

/** Compatibility entry point for older UI actions; publishing updates the channel's current calendar. */
export async function generateAndPostCalendar(serverId: string, channelId: string) {
  return postCalendarToDiscord(serverId, channelId, 0, true);
}
