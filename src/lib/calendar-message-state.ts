export type CalendarMessageMeta = {
  channelId: string;
  messageId: string;
  includeButtons?: boolean;
  lastUpdated?: Date | string | number;
  monthOffset?: number;
};

/** Keep the most recently recorded calendar message for each channel. */
export function partitionCalendarMessages(messages: readonly CalendarMessageMeta[]) {
  const currentByChannel = new Map<string, CalendarMessageMeta>();
  const superseded: CalendarMessageMeta[] = [];

  for (const message of messages) {
    const current = currentByChannel.get(message.channelId);
    if (current) superseded.push(current);
    currentByChannel.set(message.channelId, message);
  }

  return {
    current: [...currentByChannel.values()],
    superseded: superseded.filter((message) =>
      !currentByChannel.get(message.channelId)?.messageId ||
      currentByChannel.get(message.channelId)?.messageId !== message.messageId
    ),
  };
}

/** Replace a channel's tracked calendar instead of accumulating another message reference. */
export function upsertCalendarMessage(
  messages: readonly CalendarMessageMeta[],
  next: CalendarMessageMeta,
): CalendarMessageMeta[] {
  return [...partitionCalendarMessages(messages).current.filter((message) => message.channelId !== next.channelId), next];
}
