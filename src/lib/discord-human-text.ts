export type DiscordHumanTextLookup = {
  users?: Record<string, string>;
  channels?: Record<string, string>;
  roles?: Record<string, string>;
};

function cleanLabel(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function humanizeDiscordText(content: unknown, lookup: DiscordHumanTextLookup = {}): string {
  let value = String(content || '');
  const users = lookup.users || {};
  const channels = lookup.channels || {};
  const roles = lookup.roles || {};

  value = value.replace(/<@!?(\d{5,24})>/g, (_token, id: string) => {
    const name = cleanLabel(users[id]);
    return name ? `@${name}` : '@Discord user';
  });
  value = value.replace(/<#(\d{5,24})>/g, (_token, id: string) => {
    const name = cleanLabel(channels[id]);
    return name ? `#${name}` : '#Discord channel';
  });
  value = value.replace(/<@&(\d{5,24})>/g, (_token, id: string) => {
    const name = cleanLabel(roles[id]);
    return name ? `@${name}` : '@Discord role';
  });
  value = value.replace(/<(a?):([A-Za-z0-9_~.-]{1,64}):(\d{5,24})>/g, (_token, _animated: string, name: string) => `:${name}:`);

  return value;
}
