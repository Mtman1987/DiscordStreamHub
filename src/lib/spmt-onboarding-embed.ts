export interface SpmtWelcomeEmbedInput {
  serverName: string;
  username?: string | null;
  twitchLogin?: string | null;
  avatarUrl?: string | null;
  spotlightGif?: string | null;
}

export function buildSpmtWelcomeEmbed({
  serverName,
  username,
  twitchLogin,
  avatarUrl,
  spotlightGif,
}: SpmtWelcomeEmbedInput) {
  const hasSpotlight = Boolean(username && twitchLogin);
  const twitchUrl = hasSpotlight ? `https://twitch.tv/${twitchLogin}` : undefined;
  const spotlightCopy = hasSpotlight
    ? `⭐ Right now, **[${username}](${twitchUrl})** is in the community spotlight. Link your identity and your stream can join the same shoutout rotation.\n\n`
    : '';

  const embed: Record<string, unknown> = {
    title: '🚀 WELCOME ABOARD, CAPTAIN',
    description: `**${serverName}** is one connected crew across Discord, Twitch, streams, apps, events, XP, and creator rewards.\n\n${spotlightCopy}Select the button below and verify with Twitch. SPMT will securely find or create your identity, connect Discord and Twitch, and guide you through claiming or recovering your account.\n\n**One crew. One identity. An entire ecosystem.**`,
    color: 0xFFD700,
    fields: [
      { name: '🪪 One Identity', value: 'Discord + Twitch + SPMT', inline: true },
      { name: '📡 Auto Shoutouts', value: 'Added to the watchlist', inline: true },
      { name: '⭐ Spotlight', value: 'Rotating creator feature', inline: true },
    ],
    footer: {
      text: `${serverName} • Join, claim, or recover with verified Twitch`,
    },
    timestamp: new Date().toISOString(),
  };

  if (hasSpotlight) {
    embed.author = {
      name: `${username} is currently in the ${serverName} spotlight`,
      ...(avatarUrl ? { icon_url: avatarUrl } : {}),
      url: twitchUrl,
    };
    embed.url = twitchUrl;
  }
  if (avatarUrl) embed.thumbnail = { url: avatarUrl };
  if (spotlightGif) embed.image = { url: spotlightGif };

  return embed;
}
