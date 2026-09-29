// Public hunt behavior. Claims and per-hunter progress remain database state.
export const SIGNAL_DROP_TTL_MS = 60 * 60 * 1000;
export const SILENT_MESSAGE_FLAG = 4096;

const CLUES = [
  '🚀 One trail begins with the little rocket on Space Mountain. It does more than open a menu.',
  '🌀 Another trail bends gravity in Commlink. Watch the Cosmo logo and the objects drifting nearby.',
  '🚀 Visit https://spacemountain.live and inspect the docked rocket. Two quick taps can wake it up.',
  '🌀 Visit https://spmt.live/commlink/ and click the Cosmo logo. When the black hole opens, keep clicking it to stir the drifting objects.',
  '🚀 Double-click or double-tap the docked rocket on https://spacemountain.live. Guide the released rocket into the glowing ENTER HERE portal to discover the hidden Arena.',
  '🌀 In https://spmt.live/commlink/, click the Cosmo logo to open the black hole. Keep clicking the logo to kick the three drifting objects until the hole catches them. If time runs out, click the logo to try again.',
];

export function signalHuntClue(clicks: number): string {
  const index = Math.max(0, Math.floor(Number(clicks) || 0));
  // Start subtle, become actionable, and keep the two final directions available.
  return CLUES[index < CLUES.length ? index : 4 + (index % 2)];
}

export function signalDropExpired(expiresAt: unknown, now = Date.now()): boolean {
  const expiry = Date.parse(String(expiresAt || ''));
  return !Number.isFinite(expiry) || now >= expiry;
}

export function signalAlertPayload(input: {
  guildId: string; channelId: string; messageId: string; roleId: string; expiresAt: string;
}) {
  const url = `https://discord.com/channels/${input.guildId}/${input.channelId}/${input.messageId}`;
  return {
    content: `<@&${input.roleId}> 📡 A Signal is waiting in <#${input.channelId}>.`,
    embeds: [{
      title: '📡 SIGNAL LOCATED',
      description: `[Go to the Signal](${url})\nAvailable until <t:${Math.floor(Date.parse(input.expiresAt) / 1000)}:t> (<t:${Math.floor(Date.parse(input.expiresAt) / 1000)}:R>).\nIntercept it again for more clues to the other eggs.`,
      color: 0x5865f2,
      footer: { text: 'Signal alerts arrive here. Set this channel to Only @mentions for role alerts.' },
    }],
    // This new message is the deliberate notification. The source stays silent.
    allowed_mentions: { parse: [], roles: [input.roleId] },
  };
}
