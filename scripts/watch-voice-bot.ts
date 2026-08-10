import 'dotenv/config';
import {
  AudioPlayer,
  AudioResource,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  EndBehaviorType,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import { AudioFrame, AudioSource, LocalAudioTrack, Room, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import prism from 'prism-media';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  GatewayIntentBits,
  GuildMember,
  Message,
  PartialMessage,
  Partials,
  PermissionsBitField,
  TextBasedChannel,
} from 'discord.js';
import {
  APPLICATION_DEFINITIONS,
  APPLICATION_SUPPORT_FOOTER,
  SPMT_DOCS_URL,
  parseApplicationType,
} from '../src/lib/application-flow';
import { spawn, ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type WatchSession = {
  id: string;
  roomUrl: string;
  queue: Array<{ requestId: string; item: WatchItem }>;
  current: null | {
    requestId: string;
    item: WatchItem;
    requestedBy: {
      username: string;
    };
  };
  playback: {
    status: 'idle' | 'paused' | 'playing';
    position: number;
    updatedAt: number;
    volume?: number;
  };
};

type WatchRequest = {
  requestId: string;
  item: WatchItem;
};

type WatchItem = {
  id: string;
  title: string;
  playbackUrl: string;
  source: string;
  metadata?: {
    videoId?: string;
    provider?: string;
  };
};

type VoiceBridge = {
  room: Room;
  source: AudioSource;
  track: LocalAudioTrack;
  speakingHandler: (userId: string) => void;
  streams: Map<string, { opus: Readable; decoder: Readable }>;
  captureQueue: Promise<void>;
};

type WatchRequestResult =
  | { request: WatchRequest; session: WatchSession; recommendation?: null }
  | { error: string; recommendation?: WatchItem; discovery?: WatchItem };

type GuildPlayback = {
  player: AudioPlayer;
  connection: VoiceConnection;
  ffmpeg?: ChildProcessByStdio<null, Readable, Readable>;
  resource?: AudioResource;
  currentRequestId?: string;
  sessionId: string;
  textChannel?: TextBasedChannel;
  advancing?: boolean;
  advanceOnIdle?: boolean;
  pollTimer?: NodeJS.Timeout;
  bridge?: VoiceBridge;
};

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DSH_BASE_URL = (process.env.WATCHROOM_DSH_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const FORWARDING_API_BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const FFMPEG_PATH = [process.env.FFMPEG_PATH, '/usr/bin/ffmpeg']
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) || 'ffmpeg';
const MUSIC_SESSION_ID = process.env.WATCHROOM_MUSIC_SESSION_ID || 'discord-music-room';
const LIVEKIT_URL = process.env.WATCHROOM_LIVEKIT_URL || '';
const BRIDGE_ROOM_ID = process.env.WATCHROOM_BRIDGE_ROOM_ID || 'discord-activity';
const CLEANUP_AFTER_MS = Number(process.env.WATCHROOM_COMMAND_CLEANUP_MS || 120_000);
const IGNORE_FILE = process.env.WATCHROOM_IGNORE_FILE || join(process.cwd(), 'logs', 'watch-ignore-list.json');
const DISCORD_ACTIVITY_APPLICATION_ID =
  process.env.DISCORD_ACTIVITY_APPLICATION_ID ||
  process.env.DISCORD_APP_ID ||
  process.env.DISCORD_CLIENT_ID ||
  process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;

const playbackByGuild = new Map<string, GuildPlayback>();
const skipVotes = new Map<string, Set<string>>();
const ignoredByGuild = loadIgnoreList();

function loadIgnoreList() {
  try {
    if (!existsSync(IGNORE_FILE)) return new Map<string, Map<string, string>>();
    const raw = JSON.parse(readFileSync(IGNORE_FILE, 'utf8')) as Record<string, Record<string, string>>;
    return new Map(Object.entries(raw).map(([guildId, users]) => [guildId, new Map(Object.entries(users))]));
  } catch (error) {
    console.warn('[WatchVoice] Failed to read ignore list:', error);
    return new Map<string, Map<string, string>>();
  }
}

function saveIgnoreList() {
  const raw: Record<string, Record<string, string>> = {};
  for (const [guildId, users] of ignoredByGuild.entries()) raw[guildId] = Object.fromEntries(users.entries());
  mkdirSync(dirname(IGNORE_FILE), { recursive: true });
  writeFileSync(IGNORE_FILE, JSON.stringify(raw, null, 2));
}

function scheduleDelete(message: Message | null | undefined, delay = CLEANUP_AFTER_MS) {
  if (!message || delay <= 0) return;
  const timer = setTimeout(() => {
    message.delete().catch(() => {});
  }, delay);
  timer.unref?.();
}

async function replyAndMaybeDelete(message: Message, content: string, keep = false) {
  const reply = await message.reply(content);
  if (!keep) scheduleDelete(reply);
  return reply;
}

async function sendToTextChannel(channel: TextBasedChannel | undefined, content: string) {
  if (!channel || !('send' in channel) || typeof channel.send !== 'function') return;
  await channel.send(content);
}

async function notifyForwardingMessageDeleted(message: Message | PartialMessage) {
  if (!DISCORD_BOT_TOKEN) return;

  try {
    const response = await fetch(`${FORWARDING_API_BASE_URL}/api/discord/forwarding-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-discord-bot-token': DISCORD_BOT_TOKEN,
      },
      body: JSON.stringify({
        type: 'message_delete',
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
      }),
    });

    if (!response.ok) {
      console.warn(`[WatchVoice] Forwarding delete sync failed (${response.status}): ${await response.text()}`);
    }
  } catch (error) {
    console.warn('[WatchVoice] Forwarding delete sync failed:', error);
  }
}

function sessionIdFor(guildId: string, channelId: string) {
  return `${guildId || 'local'}-${channelId || 'watch'}`.replace(/[^a-zA-Z0-9_-]/g, '-');
}

async function createActivityInvite(voiceChannelId: string) {
  if (!DISCORD_ACTIVITY_APPLICATION_ID) return null;

  const response = await fetch(`https://discord.com/api/v10/channels/${voiceChannelId}/invites`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      max_age: 3600,
      max_uses: 0,
      target_type: 2,
      target_application_id: DISCORD_ACTIVITY_APPLICATION_ID,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.warn('[WatchVoice] Activity invite failed:', response.status, JSON.stringify(payload, null, 2));
    return null;
  }

  if (!payload?.code) return null;
  return `https://discord.gg/${payload.code}`;
}

function parseWatchCommand(content: string) {
  const match = content.trim().match(/^!(wr|watch)(?:\s+(.+))?$/i);
  if (!match) return null;
  return {
    command: `!${match[1].toLowerCase()}`,
    query: (match[2] || '').trim(),
  };
}

function parseDjCommand(content: string) {
  const match = content.trim().match(/^!dj(?:\s+(join|play|leave|stop|status|bridge\s+(?:on|off)))?$/i);
  if (!match) return null;
  return (match[1] || 'join').toLowerCase();
}

function parseAcceptCommand(content: string) {
  return /^!(add|accept)$/i.test(content.trim());
}

function parseSkipCommand(content: string) {
  return /^!(skip|voteskip)$/i.test(content.trim());
}

function parseIgnoreCommand(content: string) {
  const match = content.trim().match(/^!(ignore|unignore|ignored)(?:\s+(.+))?$/i);
  if (!match) return null;
  return { action: match[1].toLowerCase(), query: (match[2] || '').trim() };
}

async function handleApplicationDm(message: Message) {
  if (message.guild) return false;
  const applyMatch = message.content.trim().match(/^!apply(?:\s+(\S+))?/i);
  const serverId = process.env.NEXT_PUBLIC_HARDCODED_GUILD_ID || process.env.HARDCODED_GUILD_ID || process.env.GUILD_ID || '';
  if (applyMatch) {
    const type = parseApplicationType(applyMatch[1]);
    if (!type) {
      await message.reply('Choose one: `!apply mod`, `!apply partner`, or `!apply dev`. I will return the secure button Discord requires to open the form.');
      return true;
    }
    if (!serverId) {
      await message.reply('The SPMT application server is not configured. Please notify Mt or the crew.');
      return true;
    }
    const definition = APPLICATION_DEFINITIONS[type];
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`application_start:${type}:${serverId}`)
        .setLabel(`Start ${definition.name} Application`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setLabel('Read Terms').setURL(definition.termsUrl).setStyle(ButtonStyle.Link),
      new ButtonBuilder().setLabel('Documentation').setURL(SPMT_DOCS_URL).setStyle(ButtonStyle.Link),
    );
    await message.reply({
      content: `**SPMT ${definition.name}**\n${definition.summary}\n\n**Responsibilities:** ${definition.responsibilities}\n\n**Perks:** ${definition.perks}\n\n${APPLICATION_SUPPORT_FOOTER}`,
      components: [row],
    });
    return true;
  }

  const question = message.content.toLowerCase();
  let answer = '';
  if (/pay|paid|money|hour|time commitment/.test(question)) answer = 'SPMT participation is generally flexible and unpaid unless the Owner approves a separate written arrangement; give only time you can reliably commit.';
  else if (/perk|benefit|get/.test(question)) answer = 'Perks depend on the role and may include coordination access, ecosystem resources, recognition, and approved cross-community or SDK opportunities.';
  else if (/responsib|expect|dutie/.test(question)) answer = 'Use least privilege, protect private information, document decisions, follow published rules, escalate safely, and represent SPMT honestly.';
  else if (/vote|approval|how long|when/.test(question)) answer = 'Crew votes are advisory. The Owner makes the final decision; timing depends on review availability and whether follow-up information is needed.';
  else if (/agreement|sign|oauth|authoriz/.test(question)) answer = 'After approval, SPMT OAuth verifies your linked identity. You must then separately review and click “Accept Community Terms”; OAuth alone is not acceptance.';
  else if (/apply|form|modal/.test(question)) answer = 'Type `!apply mod`, `!apply partner`, or `!apply dev`. Discord will return a button that securely opens the application form.';
  if (answer) {
    await message.reply(`${answer}\n\nFor a role-specific policy decision, ask Mt or the Co-Owner. ${SPMT_DOCS_URL}`);
    return true;
  }
  return false;
}

function canModerate(message: Message) {
  return Boolean(message.member?.permissions.has(PermissionsBitField.Flags.ManageMessages) || message.member?.permissions.has(PermissionsBitField.Flags.Administrator));
}

function calculateSimilarity(str1: string, str2: string) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  if (longer.length === 0) return 1;
  let i = 0;
  for (let j = 0; j < longer.length && i < shorter.length; j++) {
    if (shorter[i] === longer[j]) i++;
  }
  return i / shorter.length;
}

function memberSearchText(member: GuildMember) {
  return [
    member.user.id,
    member.user.username,
    member.user.globalName || '',
    member.displayName,
  ].map((value) => value.toLowerCase());
}

async function findBestMemberMatch(message: Message, query: string) {
  const mentionId = query.match(/^<@!?(\d+)>$/)?.[1] || query.match(/^\d{15,25}$/)?.[0];
  if (mentionId) return message.guild?.members.fetch(mentionId).catch(() => null);
  if (!message.guild || !query) return null;

  const search = query.toLowerCase();
  await message.guild.members.fetch({ query, limit: 20 }).catch(() => null);
  const members = [...message.guild.members.cache.values()];
  const exact = members.find((member) => memberSearchText(member).some((value) => value === search));
  if (exact) return exact;
  const starts = members.find((member) => memberSearchText(member).some((value) => value.startsWith(search)));
  if (starts) return starts;
  const contains = members.find((member) => memberSearchText(member).some((value) => value.includes(search)));
  if (contains) return contains;

  let best: GuildMember | null = null;
  let bestScore = 0;
  for (const member of members) {
    const score = Math.max(...memberSearchText(member).map((value) => calculateSimilarity(search, value)));
    if (score > bestScore && score >= 0.6) {
      best = member;
      bestScore = score;
    }
  }
  return best;
}

function isIgnored(message: Message) {
  return Boolean(message.guild && ignoredByGuild.get(message.guild.id)?.has(message.author.id));
}

async function dshApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DSH_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DSH API ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

async function requestWatchItem(params: {
  sessionId: string;
  query: string;
  userId: string;
  username: string;
}) {
  const response = await fetch(`${DSH_BASE_URL}/api/watch/sessions/${params.sessionId}/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: params.query,
      userId: params.userId,
      username: params.username,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return payload as WatchRequestResult;
  return payload as WatchRequestResult;
}

async function acceptRecommendation(params: {
  sessionId: string;
  userId: string;
  username: string;
}) {
  return dshApi<{ request: WatchRequest; session: WatchSession }>(`/api/watch/sessions/${params.sessionId}/accept`, {
    method: 'POST',
    body: JSON.stringify({
      userId: params.userId,
      username: params.username,
    }),
  });
}

async function controlSession(sessionId: string, action: string, position = 0) {
  return dshApi<WatchSession>(`/api/watch/sessions/${sessionId}/control`, {
    method: 'POST',
    body: JSON.stringify({ action, position }),
  });
}

async function getSession(sessionId: string) {
  return dshApi<WatchSession>(`/api/watch/sessions/${sessionId}/state`);
}

function stopFfmpeg(playback: GuildPlayback) {
  if (playback.ffmpeg && !playback.ffmpeg.killed) {
    playback.ffmpeg.kill('SIGKILL');
  }
  playback.ffmpeg = undefined;
}

async function startVoiceBridge(message: Message, playback: GuildPlayback) {
  if (playback.bridge) return 'Discord voice bridge is already ON.';
  if (!LIVEKIT_URL) throw new Error('LiveKit URL is not configured for the Discord voice bridge.');

  playback.connection.rejoin({ channelId: playback.connection.joinConfig.channelId, selfDeaf: false, selfMute: false });
  await entersState(playback.connection, VoiceConnectionStatus.Ready, 20_000);

  const tokenResponse = await fetch(`${DSH_BASE_URL}/api/livekit-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hmo-dj-worker': '1' },
    body: JSON.stringify({ roomId: BRIDGE_ROOM_ID, userName: 'Discord Voice Bridge', musicRoom: true, isDJ: true }),
  });
  if (!tokenResponse.ok) throw new Error(`HearMeOut LiveKit token failed (${tokenResponse.status})`);
  const tokenPayload = await tokenResponse.json() as { token?: string };
  if (!tokenPayload.token) throw new Error('HearMeOut did not return a LiveKit token.');

  const room = new Room();
  await room.connect(LIVEKIT_URL, tokenPayload.token);
  const participant = room.localParticipant;
  if (!participant) throw new Error('LiveKit local participant is unavailable.');
  const source = new AudioSource(48_000, 2);
  const track = LocalAudioTrack.createAudioTrack('discord-voice-bridge', source);
  await participant.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));

  const bridge: VoiceBridge = {
    room,
    source,
    track,
    streams: new Map(),
    captureQueue: Promise.resolve(),
    speakingHandler: () => {},
  };

  bridge.speakingHandler = (userId: string) => {
    if (bridge.streams.has(userId) || userId === message.client.user.id) return;
    const member = message.guild?.members.cache.get(userId);
    if (member?.user.bot) return;

    const opus = playback.connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 250 },
    });
    const decoder = new prism.opus.Decoder({ rate: 48_000, channels: 2, frameSize: 960 });
    bridge.streams.set(userId, { opus, decoder });
    let pending = Buffer.alloc(0);
    opus.pipe(decoder);
    decoder.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 3_840) {
        const pcm = Buffer.from(pending.subarray(0, 3_840));
        pending = pending.subarray(3_840);
        const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
        const frame = new AudioFrame(samples, 48_000, 2, 960);
        bridge.captureQueue = bridge.captureQueue
          .then(() => bridge.source.captureFrame(frame))
          .catch((error) => console.warn('[WatchVoice] Bridge frame failed:', error.message));
      }
    });
    const cleanup = () => bridge.streams.delete(userId);
    opus.once('close', cleanup);
    opus.once('end', cleanup);
    opus.once('error', cleanup);
  };

  playback.connection.receiver.speaking.on('start', bridge.speakingHandler);
  playback.bridge = bridge;
  return `Discord voice bridge is ON. Voices are being relayed to HearMeOut room **${BRIDGE_ROOM_ID}**; use \`!dj bridge off\` to stop.`;
}

async function stopVoiceBridge(playback: GuildPlayback) {
  const bridge = playback.bridge;
  if (!bridge) return 'Discord voice bridge is already OFF.';
  playback.connection.receiver.speaking.off('start', bridge.speakingHandler);
  for (const stream of bridge.streams.values()) {
    stream.opus.destroy();
    stream.decoder.destroy();
  }
  bridge.streams.clear();
  try { await bridge.room.disconnect(); } catch {}
  playback.bridge = undefined;
  playback.connection.rejoin({ channelId: playback.connection.joinConfig.channelId, selfDeaf: true, selfMute: false });
  return 'Discord voice bridge is OFF.';
}

function createFfmpegAudioStream(item: WatchItem) {
  const playbackUrl = new URL(item.playbackUrl, `${DSH_BASE_URL}/`).toString();
  const args = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '5',
    '-i',
    playbackUrl,
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-f',
    's16le',
    'pipe:1',
  ];

  console.log(`[WatchVoice] Starting ffmpeg for ${item.title}: ${playbackUrl}`);
  const ffmpeg = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  ffmpeg.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) console.warn(`[WatchVoice:ffmpeg] ${line}`);
  });
  ffmpeg.on('exit', (code, signal) => {
    console.log(`[WatchVoice] ffmpeg exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });
  return ffmpeg;
}

async function playCurrent(guildId: string, sessionId: string) {
  const playback = playbackByGuild.get(guildId);
  if (!playback) return;

  const session = await getSession(sessionId);
  if (!session.current) {
    await sendToTextChannel(playback.textChannel, 'Watch queue ended.');
    stopFfmpeg(playback);
    playback.currentRequestId = undefined;
    return;
  }

  if (playback.currentRequestId === session.current.requestId) return;

  stopFfmpeg(playback);
  playback.advanceOnIdle = false;
  playback.currentRequestId = session.current.requestId;

  const ffmpeg = createFfmpegAudioStream(session.current.item);
  playback.ffmpeg = ffmpeg;
  ffmpeg.once('exit', (code) => {
    playback.advanceOnIdle = code === 0;
    if (code !== 0) {
      sendToTextChannel(playback.textChannel, `Could not play **${session.current?.item.title || 'the current song'}** in Discord voice.`).catch(() => {});
    }
  });

  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  });
  playback.resource = resource;
  resource.volume?.setVolume(0.85);

  playback.player.play(resource);
  await controlSession(sessionId, 'play', 0).catch(() => {});
  console.log(`[WatchVoice] Voice audio playing: ${session.current.item.title}`);
}

async function advanceToNext(guildId: string, sessionId: string) {
  const playback = playbackByGuild.get(guildId);
  if (!playback || playback.advancing) return;

  playback.advancing = true;
  try {
    await controlSession(sessionId, 'next', 0);
    playback.currentRequestId = undefined;
    await playCurrent(guildId, sessionId);
  } catch (error) {
    console.error('[WatchVoice] Failed to advance queue:', error);
  } finally {
    playback.advancing = false;
  }
}

async function getOrJoinPlayback(message: Message, sessionId: string) {
  if (!message.guild || !message.member) {
    throw new Error('This command must be used in a guild.');
  }

  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    throw new Error('Join a voice channel first, then run the watch command again.');
  }

  if (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice) {
    throw new Error('Unsupported voice channel type.');
  }

  const existing = playbackByGuild.get(message.guild.id);
  if (existing && existing.connection.joinConfig.channelId === voiceChannel.id) {
    existing.textChannel = message.channel;
    existing.sessionId = sessionId;
    return existing;
  }

  const oldConnection = getVoiceConnection(message.guild.id);
  oldConnection?.destroy();

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: message.guild.id,
    adapterCreator: message.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
    daveEncryption: true,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

  const player = createAudioPlayer();
  connection.subscribe(player);

  const playback: GuildPlayback = {
    player,
    connection,
    sessionId,
    textChannel: message.channel,
  };

  player.on(AudioPlayerStatus.Idle, () => {
    stopFfmpeg(playback);
    skipVotes.delete(sessionId);
    if (playback.advanceOnIdle) {
      playback.advanceOnIdle = false;
      advanceToNext(message.guild!.id, playback.sessionId).catch((error) => {
        console.error('[WatchVoice] Automatic queue advance failed:', error);
      });
    } else {
      console.log('[WatchVoice] Voice audio became idle without a completed track; leaving current item unchanged.');
    }
  });

  player.on('error', (error) => {
    console.error('[WatchVoice] Audio player error:', error);
    sendToTextChannel(playback.textChannel, `Voice playback error: ${error.message}`).catch(() => {});
  });

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    stopFfmpeg(playback);
    if (playback.pollTimer) clearInterval(playback.pollTimer);
    if (playback.bridge) stopVoiceBridge(playback).catch(() => {});
    playbackByGuild.delete(message.guild!.id);
  });

  playbackByGuild.set(message.guild.id, playback);
  playback.pollTimer = setInterval(() => {
    getSession(playback.sessionId)
      .then((session) => {
        if (session.current?.requestId !== playback.currentRequestId) return playCurrent(message.guild!.id, playback.sessionId);
        if (session.playback.status === 'paused') playback.player.pause();
        if (session.playback.status === 'playing' && playback.player.state.status === AudioPlayerStatus.Paused) playback.player.unpause();
        if (playback.resource?.volume && typeof session.playback.volume === 'number') {
          playback.resource.volume.setVolume(Math.max(0, Math.min(1, session.playback.volume / 100)));
        }
      })
      .catch((error) => console.warn('[WatchVoice] Music session poll failed:', error.message));
  }, 2_000);
  playback.pollTimer.unref?.();
  return playback;
}

async function forwardUnhandledDm(message: Message) {
  const payload = {
    userId: message.author.id,
    userName: message.author.globalName || message.author.username,
    displayName: message.author.globalName || message.author.username,
    userAvatar: message.author.displayAvatarURL({ size: 256 }),
    channelId: message.channelId,
    messageId: message.id,
    message: message.content,
    content: message.content,
    isDM: true,
    isDirectMessage: true,
    dispatch: true,
    source: 'dsh-discord-gateway',
    author: {
      id: message.author.id,
      username: message.author.username,
      bot: message.author.bot,
    },
    attachments: [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      proxyUrl: attachment.proxyURL,
      contentType: attachment.contentType,
      size: attachment.size,
    })),
    embeds: message.embeds.map((embed) => embed.toJSON()),
  };

  const response = await fetch(`${FORWARDING_API_BASE_URL}/api/discord/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-chat-origin': 'dsh-discord-gateway',
      'x-discord-trace-id': message.id,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Discord DM forward failed: ${response.status} ${JSON.stringify(result)}`);
  }
  console.log(`[WatchVoice] Forwarded Discord DM from ${message.author.username} to DSH chat`);
}

async function handleMessage(message: Message) {
  if (message.author.bot) return;
  if (await handleApplicationDm(message)) return;
  if (!message.guild) {
    await forwardUnhandledDm(message);
    return;
  }

  const djCommand = parseDjCommand(message.content);
  if (djCommand) {
    scheduleDelete(message);
    try {
      const existing = playbackByGuild.get(message.guild.id);
      if (djCommand === 'leave' || djCommand === 'stop') {
        if (!existing) {
          await replyAndMaybeDelete(message, 'SPMT DJ is not connected.');
          return;
        }
        if (existing.bridge) await stopVoiceBridge(existing);
        if (existing.pollTimer) clearInterval(existing.pollTimer);
        stopFfmpeg(existing);
        existing.connection.destroy();
        playbackByGuild.delete(message.guild.id);
        await replyAndMaybeDelete(message, 'SPMT DJ left the voice channel.');
        return;
      }

      const playback = existing || await getOrJoinPlayback(message, MUSIC_SESSION_ID);
      playback.sessionId = MUSIC_SESSION_ID;
      const voiceState = message.guild.members.me?.voice;

      if (djCommand === 'bridge on') {
        const result = await startVoiceBridge(message, playback);
        await replyAndMaybeDelete(message, result, true);
        return;
      }
      if (djCommand === 'bridge off') {
        const result = await stopVoiceBridge(playback);
        await replyAndMaybeDelete(message, result, true);
        return;
      }
      if (djCommand === 'status') {
        await replyAndMaybeDelete(message, `SPMT DJ: connected=${playback.connection.state.status === VoiceConnectionStatus.Ready}, serverMuted=${voiceState?.serverMute === true}, music=${playback.currentRequestId ? 'loaded' : 'waiting'}, bridge=${playback.bridge ? 'ON' : 'OFF'}.`);
        return;
      }

      if (voiceState?.serverMute) {
        await replyAndMaybeDelete(message, 'SPMT DJ joined, but Discord has it server-muted. Unmute the bot, then run `!dj play`.');
        return;
      }
      await playCurrent(message.guild.id, MUSIC_SESSION_ID);
      await replyAndMaybeDelete(message, 'SPMT DJ joined and is playing HearMeOut’s shared music room. Controls in HearMeOut and Discord now target the same queue.', true);
    } catch (error: any) {
      console.error('[WatchVoice] DJ command failed:', error);
      await replyAndMaybeDelete(message, error.message || 'SPMT DJ command failed.');
    }
    return;
  }

  const ignoreCommand = parseIgnoreCommand(message.content);
  if (ignoreCommand) {
    scheduleDelete(message);
    if (!canModerate(message)) {
      await replyAndMaybeDelete(message, 'Only moderators can manage the watch ignore list.');
      return;
    }

    const guildIgnored = ignoredByGuild.get(message.guild.id) || new Map<string, string>();
    ignoredByGuild.set(message.guild.id, guildIgnored);

    if (ignoreCommand.action === 'ignored') {
      const names = [...guildIgnored.values()];
      await replyAndMaybeDelete(message, names.length ? `Ignored watch users: ${names.join(', ')}` : 'No users are ignored for watch requests.');
      return;
    }

    if (!ignoreCommand.query) {
      await replyAndMaybeDelete(message, `Usage: !${ignoreCommand.action} <username or mention>`);
      return;
    }

    const target = await findBestMemberMatch(message, ignoreCommand.query);
    if (!target) {
      await replyAndMaybeDelete(message, `No Discord user matched "${ignoreCommand.query}".`);
      return;
    }

    if (ignoreCommand.action === 'ignore') {
      guildIgnored.set(target.id, target.displayName || target.user.username);
      saveIgnoreList();
      await replyAndMaybeDelete(message, `Ignored ${target.displayName || target.user.username} for watch requests.`);
      return;
    }

    guildIgnored.delete(target.id);
    saveIgnoreList();
    await replyAndMaybeDelete(message, `Removed ${target.displayName || target.user.username} from the watch ignore list.`);
    return;
  }

  if (isIgnored(message) && (parseWatchCommand(message.content) || parseAcceptCommand(message.content) || parseSkipCommand(message.content))) {
    scheduleDelete(message);
    return;
  }

  if (parseSkipCommand(message.content)) {
    scheduleDelete(message);
    try {
      const voiceChannel = message.member?.voice.channel;
      if (!voiceChannel) {
        await replyAndMaybeDelete(message, 'Join the voice channel first, then run !skip.');
        return;
      }

      const sessionId = sessionIdFor(message.guild.id, voiceChannel.id);
      const session = await getSession(sessionId);
      if (!session.current) {
        await replyAndMaybeDelete(message, 'Nothing is currently playing.');
        return;
      }

      if (canModerate(message)) {
        await replyAndMaybeDelete(message, 'Moderator skipped the current watch item.');
        skipVotes.delete(sessionId);
        await advanceToNext(message.guild.id, sessionId);
        return;
      }

      const voters = skipVotes.get(sessionId) || new Set<string>();
      skipVotes.set(sessionId, voters);
      voters.add(message.author.id);
      const listenerCount = voiceChannel.members.filter((member) => !member.user.bot).size;
      const needed = Math.max(1, Math.ceil(listenerCount / 2));

      if (voters.size >= needed) {
        await replyAndMaybeDelete(message, `Vote skip passed (${voters.size}/${needed}).`);
        skipVotes.delete(sessionId);
        await advanceToNext(message.guild.id, sessionId);
      } else {
        await replyAndMaybeDelete(message, `Vote skip: ${voters.size}/${needed}.`);
      }
    } catch (error: any) {
      console.error('[WatchVoice] Skip failed:', error);
      await replyAndMaybeDelete(message, error.message || 'Vote skip failed.');
    }
    return;
  }

  if (parseAcceptCommand(message.content)) {
    scheduleDelete(message);
    try {
      const voiceChannel = message.member?.voice.channel;
      if (!voiceChannel) {
        throw new Error('Join a voice channel first, then run !add again.');
      }

      const sessionId = sessionIdFor(message.guild.id, voiceChannel.id);
      const result = await acceptRecommendation({
        sessionId,
        userId: message.author.id,
        username: message.member?.displayName || message.author.username,
      });

      const currentRequestId = result.session.current?.requestId;
      const addedAsCurrent = Boolean(currentRequestId && currentRequestId === result.request.requestId);
      const queuePosition = result.session.queue.length;
      const activityInvite = await createActivityInvite(voiceChannel.id);
      const activityLine = activityInvite ? `\nActivity: ${activityInvite}` : '';
      const title = result.request.item.title;

      await message.reply(
        addedAsCurrent
          ? `Added **${title}** from Internet Archive.${activityLine}`
          : `Queued **${title}** from Internet Archive at position ${queuePosition}.${activityLine}`
      ).then((reply) => { if (!activityInvite) scheduleDelete(reply); });
    } catch (error: any) {
      console.error('[WatchVoice] Accept failed:', error);
      await replyAndMaybeDelete(message, error.message || 'No pending Internet Archive recommendation.');
    }
    return;
  }

  const parsed = parseWatchCommand(message.content);
  if (!parsed) return;
  scheduleDelete(message);

  if (!parsed.query) {
    await replyAndMaybeDelete(message, `Usage: ${parsed.command} <movie, show, or test stream>`);
    return;
  }

  try {
    const voiceChannel = message.member?.voice.channel;
    if (!voiceChannel) {
      throw new Error('Join a voice channel first, then run the watch command again.');
    }

    const sessionId = sessionIdFor(message.guild.id, voiceChannel.id);
    const result = await requestWatchItem({
      sessionId,
      query: parsed.query,
      userId: message.author.id,
      username: message.member?.displayName || message.author.username,
    });

    if ('error' in result) {
      if (result.discovery) {
        await replyAndMaybeDelete(message,
          `No playable Xtream/VOD match found. Watchmode found **${result.discovery.title}** as a likely title, but Watchmode is discovery only and does not provide a playable stream.`
        );
        return;
      }
      if (result.recommendation) {
        await replyAndMaybeDelete(message,
          `No playable Xtream VOD/live match found. Internet Archive returned best title comparison: **${result.recommendation.title}**. Type \`!add\` to accept this recommendation.`
        );
        return;
      }
      throw new Error(result.error || 'No matching watch item found.');
    }

    const currentRequestId = result.session.current?.requestId;
    const addedAsCurrent = Boolean(currentRequestId && currentRequestId === result.request.requestId);
    const queuePosition = result.session.queue.length;
    const activityInvite = await createActivityInvite(voiceChannel.id);
    const activityLine = activityInvite ? `\nActivity: ${activityInvite}` : '';
    const title = result.request.item.title;

    await message.reply(
      addedAsCurrent
        ? `Added **${title}**.${activityLine}`
        : `Queued **${title}** at position ${queuePosition}.${activityLine}`
    ).then((reply) => { if (!activityInvite) scheduleDelete(reply); });
  } catch (error: any) {
    console.error('[WatchVoice] Command failed:', error);
    await replyAndMaybeDelete(message, error.message || 'Watch voice command failed.');
  }
}

async function main() {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN is required in .env');
  }

  console.log(`[WatchVoice] Starting. DSH API: ${DSH_BASE_URL}`);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once('clientReady', () => {
    console.log(`[WatchVoice] Logged in as ${client.user?.tag}`);
    console.log(`[WatchVoice] Using DSH API at ${DSH_BASE_URL}`);
  });

  client.on('error', (error) => {
    console.error('[WatchVoice] Discord client error:', error);
  });

  client.on('warn', (warning) => {
    console.warn('[WatchVoice] Discord client warning:', warning);
  });

  client.on('messageCreate', (message) => {
    handleMessage(message).catch((error) => {
      console.error('[WatchVoice] Unhandled message error:', error);
    });
  });

  client.on('messageDelete', (message) => {
    notifyForwardingMessageDeleted(message).catch((error) => {
      console.error('[WatchVoice] Unhandled forwarding delete sync error:', error);
    });
  });

  client.on('messageDeleteBulk', (messages) => {
    for (const message of messages.values()) {
      notifyForwardingMessageDeleted(message).catch((error) => {
        console.error('[WatchVoice] Unhandled bulk forwarding delete sync error:', error);
      });
    }
  });

  const loginTimer = setTimeout(() => {
    console.warn('[WatchVoice] Still waiting for Discord ready event after 20 seconds. Check token, gateway access, and network.');
  }, 20_000);

  await client.login(DISCORD_BOT_TOKEN);
  client.once('clientReady', () => clearTimeout(loginTimer));
}

main().catch((error) => {
  console.error('[WatchVoice] Fatal:', error);
  process.exit(1);
});
