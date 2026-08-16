import { db } from '@/lib/db';
import { getChatTagApiBase, getChatTagBotUrl, getChatTagChannelId } from '@/lib/runtime-config';
import { getChatTagServiceSecret } from '@/lib/runtime-secrets';

const CHAT_TAG_API = getChatTagApiBase();
const CHAT_TAG_BOT_URL = getChatTagBotUrl();
const CHAT_TAG_CHANNEL_ID = getChatTagChannelId();

// ── API helpers ──

async function tagApi(endpoint: string, options: RequestInit = {}): Promise<any> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${CHAT_TAG_API}${endpoint}`, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`[ChatTag] API ${endpoint} returned ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e: any) {
    console.error(`[ChatTag] API error ${endpoint}:`, e.message);
    return null;
  }
}

async function postTagApi(endpoint: string, body: any): Promise<any> {
  return tagApi(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Discord helpers ──

const CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes

function timeoutSignal(milliseconds: number) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

async function getOrCreateDiscordWebhook(channelId: string, botToken: string) {
  const webhookDoc = await db.collection('webhooks').doc(channelId).get();
  const savedWebhook = webhookDoc.exists ? webhookDoc.data() : null;
  if (savedWebhook?.id && savedWebhook?.token) return savedWebhook;

  const webhooksRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
    headers: { Authorization: `Bot ${botToken}` },
    signal: timeoutSignal(7_000),
  });

  if (webhooksRes.ok) {
    const webhooks = await webhooksRes.json();
    const existing = Array.isArray(webhooks)
      ? webhooks.find((entry: any) => entry.name === 'Chat Tag') || webhooks.find((entry: any) => entry.name === 'Stream Hub')
      : null;
    if (existing?.id && existing?.token) {
      await db.collection('webhooks').doc(channelId).set({
        id: existing.id,
        token: existing.token,
        channelId,
        name: existing.name || 'Chat Tag',
      });
      return existing;
    }
  }

  const createRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Chat Tag' }),
    signal: timeoutSignal(7_000),
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create webhook: ${createRes.status} ${await createRes.text()}`);
  }

  const webhook = await createRes.json();
  await db.collection('webhooks').doc(channelId).set({
    id: webhook.id,
    token: webhook.token,
    channelId,
    name: webhook.name || 'Chat Tag',
  });
  return webhook;
}

async function sendDiscordReply(channelId: string, content: string, userMessageId?: string): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.error('[ChatTag] sendDiscordReply: No DISCORD_BOT_TOKEN');
    return;
  }
  if (!channelId) {
    console.error('[ChatTag] sendDiscordReply: No channelId');
    return;
  }
  try {
    const webhook = await getOrCreateDiscordWebhook(channelId, botToken);
    const res = await fetch(`https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.token}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, username: 'Chat Tag' }),
      signal: timeoutSignal(7_000),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ChatTag] webhook reply failed (${res.status}): ${errText}`);
      return;
    }
    const webhookMsg = await res.json();
    console.log(`[ChatTag] Webhook reply sent to ${channelId}: ${content.slice(0, 80)}...`);

    // Auto-cleanup after 5 minutes: delete bot reply + user's original message
    setTimeout(() => {
      // Delete webhook reply
      if (webhookMsg?.id) {
        fetch(`https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.token}/messages/${webhookMsg.id}`, {
          method: 'DELETE',
        }).catch(() => {});
      }
      // Delete user's original command message
      if (userMessageId) {
        fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${userMessageId}`, {
          method: 'DELETE', headers: { Authorization: `Bot ${botToken}` },
        }).catch(() => {});
      }
    }, CLEANUP_DELAY_MS);
  } catch (e: any) {
    console.error(`[ChatTag] sendDiscordReply error: ${e.message}`);
  }
}

async function sendDiscordEmbed(channelId: string, payload: any): Promise<string | null> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN is not configured');
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord embed post failed (${res.status}): ${text.slice(0, 300) || res.statusText}`);
  }
  const data = await res.json();
  return data.id || null;
}

async function editDiscordMessage(channelId: string, messageId: string, payload: any): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN is not configured');
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord embed edit failed (${res.status}): ${text.slice(0, 300) || res.statusText}`);
  }
}

// ── Twitch bot broadcast ──

function broadcastToTwitch(message: string): void {
  fetch(`${CHAT_TAG_BOT_URL}/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  }).catch((e) => console.error('[ChatTag] Broadcast to Twitch failed:', e.message));
}

// ── Twitch username lookup ──

async function getTwitchLogin(guildId: string, discordUserId: string): Promise<string | null> {
  try {
    const doc = await db.collection('servers').doc(guildId).collection('users').doc(discordUserId).get();
    return doc.data()?.twitchLogin || null;
  } catch {
    return null;
  }
}

// ── Command handler ──

export async function handleSpmtCommand(
  message: string,
  discordUserId: string,
  discordUserName: string,
  guildId: string,
  channelId: string,
  userMessageId?: string
): Promise<void> {
  const msg = message.toLowerCase().trim();
  if (!msg.startsWith('@spmt ')) return;

  const parts = msg.split(/\s+/).slice(1);
  const cmd = parts[0];
  if (!cmd) return;

  const twitchLogin = await getTwitchLogin(guildId, discordUserId);
  const displayName = discordUserName;

  console.log(`[ChatTag] Discord command: ${cmd} from ${displayName} (twitch: ${twitchLogin || 'unlinked'})`);

  // Find this user's player ID by twitchUsername match, or by discord_ ID
  async function findPlayerId(): Promise<string | null> {
    const data = await tagApi('/api/tag');
    if (!data?.players) return null;
    // Try by linked Twitch login first
    if (twitchLogin) {
      const player = data.players.find((p: any) => (p.twitchUsername || '').toLowerCase() === twitchLogin.toLowerCase());
      if (player) return player.id;
    }
    // Fallback: try by discord_ ID
    const discordId = `discord_${discordUserId}`;
    const byDiscord = data.players.find((p: any) => p.id === discordId);
    return byDiscord?.id || null;
  }

  if (cmd === 'join') {
    const targetArg = parts[1]?.replace('@', '');
    const joinUsername = targetArg || twitchLogin;
    
    if (!joinUsername) {
      // No Twitch link and no target — tell them to specify their Twitch name
      await sendDiscordReply(channelId,
        `❌ ${displayName}: Your Discord isn't linked to Twitch. Use \`@spmt join <twitch_username>\` to join with your Twitch name.`,
        userMessageId
      );
      return;
    }

    // Check if player already exists by twitchUsername
    const existingData = await tagApi('/api/tag');
    const existingPlayer = existingData?.players?.find((p: any) =>
      (p.twitchUsername || '').toLowerCase() === joinUsername.toLowerCase()
    );
    if (existingPlayer) {
      await sendDiscordReply(channelId, `✅ ${displayName}, you're already in the game as ${joinUsername}!`, userMessageId);
      return;
    }
    const res = await postTagApi('/api/tag', {
      action: 'join',
      userId: `discord_${discordUserId}`,
      twitchUsername: joinUsername.toLowerCase(),
      avatar: '',
    });
    await sendDiscordReply(channelId,
      res?.error ? `❌ ${displayName}: ${res.error}` : `🎯 ${displayName} joined the tag game as ${joinUsername}!`
    , userMessageId);
  }

  else if (cmd === 'leave') {
    const playerId = await findPlayerId();
    if (!playerId) { await sendDiscordReply(channelId, `❌ ${displayName}: You're not in the game!`, userMessageId); return; }
    await postTagApi('/api/tag', { action: 'leave', userId: playerId });
    await sendDiscordReply(channelId, `👋 ${displayName} left the tag game.`, userMessageId);
  }

  else if (cmd === 'tag') {
    const target = parts[1]?.replace('@', '').toLowerCase();
    if (!target) {
      await sendDiscordReply(channelId, `❌ ${displayName}: Usage: spmt tag @username`, userMessageId);
      return;
    }
    const playerId = await findPlayerId();
    if (!playerId) { await sendDiscordReply(channelId, `❌ ${displayName}: You're not in the game! Use spmt join`, userMessageId); return; }
    const playersData = await tagApi('/api/tag');
    const targetPlayer = playersData?.players?.find((p: any) =>
      (p.twitchUsername || p.username)?.toLowerCase() === target
    );
    if (!targetPlayer) {
      await sendDiscordReply(channelId, `❌ ${displayName}: ${target} is not in the game!`, userMessageId);
      return;
    }

    // Pin's special tag tracking
    const isPinscorpion = twitchLogin?.toLowerCase() === 'pinscorpion6521';
    if (isPinscorpion) {
      const pinRes = await postTagApi('/api/tag', {
        action: 'pin-tag',
        userId: playerId,
        targetUserId: targetPlayer.id,
      });
      const pinCount = pinRes?.count || '?';

      // Check if pin is "it" or FFA
      const pinPlayer = playersData?.players?.find((p: any) => p.id === playerId);
      const anyoneIt = playersData?.players?.some((p: any) => p.isIt);
      if (pinPlayer?.isIt || !anyoneIt) {
        const realRes = await postTagApi('/api/tag', {
          action: 'tag', userId: playerId, twitchUsername: twitchLogin,
          targetUserId: targetPlayer.id, streamerId: 'discord',
        });
        if (realRes?.error) {
          await sendDiscordReply(channelId, `❌ ${displayName}: ${realRes.error}`, userMessageId);
        } else {
          const msg = realRes.doublePoints
            ? `🔥 ${displayName} tagged @${target} for DOUBLE POINTS! @${target} is now it! (Pin has tagged them ${pinCount} times total)`
            : `🎯 ${displayName} tagged @${target}! @${target} is now it! (Pin has tagged them ${pinCount} times total)`;
          await sendDiscordReply(channelId, msg, userMessageId);
          await postTagApi('/api/discord/announce', { tagger: displayName, tagged: target, doublePoints: realRes.doublePoints });
          broadcastToTwitch(msg);
        }
      } else {
        await sendDiscordReply(channelId, `🎯 ${displayName} tagged @${target}! (Pin has tagged them ${pinCount} times total)`, userMessageId);
      }
      return;
    }

    const res = await postTagApi('/api/tag', {
      action: 'tag',
      userId: playerId,
      twitchUsername: twitchLogin || discordUserName.toLowerCase(),
      targetUserId: targetPlayer.id,
      streamerId: 'discord',
    });
    if (res?.error) {
      await sendDiscordReply(channelId, `❌ ${displayName}: ${res.error}`, userMessageId);
    } else {
      const taggerName = twitchLogin || displayName;
      const tagMsg = res.doublePoints
        ? `🔥 ${taggerName} tagged @${target} for DOUBLE POINTS! @${target} is now it! Type "@spmt join" to play!`
        : `🎯 ${taggerName} tagged @${target}! @${target} is now it! Type "@spmt join" to play!`;
      await sendDiscordReply(channelId, tagMsg, userMessageId);
      await postTagApi('/api/discord/announce', {
        tagger: taggerName,
        tagged: target,
        doublePoints: res.doublePoints,
      });
      broadcastToTwitch(tagMsg);
    }
  }

  else if (cmd === 'status' || cmd === 'whosit') {
    const data = await tagApi('/api/tag');
    const itPlayer = data?.players?.find((p: any) => p.isIt);
    const itName = itPlayer ? (itPlayer.twitchUsername || 'Someone') : null;
    await sendDiscordReply(channelId,
      itName ? `🎯 ${itName} is it!` : `🔥 FREE FOR ALL! Anyone can tag for DOUBLE POINTS!`
    , userMessageId);
  }

  else if (cmd === 'score') {
    const data = await tagApi('/api/tag');
    const players = data?.players || [];
    const player = twitchLogin
      ? players.find((p: any) => (p.twitchUsername || '').toLowerCase() === twitchLogin.toLowerCase())
      : null;
    if (!player) {
      await sendDiscordReply(channelId, `❌ ${displayName}: You're not in the game! Use @spmt join`, userMessageId);
      return;
    }
    const sorted = [...players].sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
    const rank = sorted.findIndex((p: any) => p.id === player.id) + 1;
    await sendDiscordReply(channelId,
      `📊 ${displayName} — Rank: #${rank}/${sorted.length} | Score: ${player.score || 0} pts | Tags: ${player.tags || 0} | Tagged: ${player.tagged || 0} | Pass: ${player.hasPass ? '✅' : '❌'}`
    , userMessageId);
  }

  else if (cmd === 'rank') {
    const data = await tagApi('/api/tag');
    const sorted = (data?.players || [])
      .filter((p: any) => (p.twitchUsername || p.username)?.toLowerCase() !== 'mtman1987')
      .sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
    const top3 = sorted.slice(0, 3);
    const rankings = top3.map((p: any, i: number) =>
      `#${i + 1} ${p.twitchUsername || p.username}: ${p.score || 0}`
    ).join(' | ');
    await sendDiscordReply(channelId, `🏆 Top 3: ${rankings}`, userMessageId);
  }

  else if (cmd === 'sleep') {
    const playerId = await findPlayerId();
    if (!playerId) { await sendDiscordReply(channelId, `❌ ${displayName}: You're not in the game!`, userMessageId); return; }
    await postTagApi('/api/tag', { action: 'sleep', userId: playerId });
    await sendDiscordReply(channelId, `😴 ${displayName} is now sleeping (immune).`, userMessageId);
  }

  else if (cmd === 'wake') {
    const playerId = await findPlayerId();
    if (!playerId) { await sendDiscordReply(channelId, `❌ ${displayName}: You're not in the game!`, userMessageId); return; }
    await postTagApi('/api/tag', { action: 'wake', userId: playerId });
    await sendDiscordReply(channelId, `☀️ ${displayName} is now awake!`, userMessageId);
  }

  else if (cmd === 'pass') {
    const target = parts[1]?.replace('@', '').toLowerCase();
    if (!target) {
      await sendDiscordReply(channelId, `❌ Usage: @spmt pass @username`, userMessageId);
      return;
    }
    const playerId = await findPlayerId();
    if (!playerId) { await sendDiscordReply(channelId, `❌ ${displayName}: You're not in the game!`, userMessageId); return; }
    const playersData = await tagApi('/api/tag');
    const targetPlayer = playersData?.players?.find((p: any) =>
      (p.twitchUsername || p.username)?.toLowerCase() === target
    );
    if (!targetPlayer) {
      await sendDiscordReply(channelId, `❌ ${target} is not in the game!`, userMessageId);
      return;
    }
    const res = await postTagApi('/api/tag', {
      action: 'use-pass',
      userId: playerId,
      targetUserId: targetPlayer.id,
      streamerId: 'discord',
    });
    if (res?.error) {
      await sendDiscordReply(channelId, `❌ ${displayName}: ${res.error}`, userMessageId);
    } else {
      const passerName = twitchLogin || displayName;
      const passMsg = `🎟️ ${passerName} used their PASS to tag @${target} for DOUBLE POINTS! @${target} is now it! Raid, follow, cheer, or sub to earn yours!`;
      await postTagApi('/api/discord/announce', {
        tagger: passerName,
        tagged: target,
        doublePoints: true,
        message: 'Used a Pass',
      });
      broadcastToTwitch(passMsg);
    }
  }

  else if (cmd === 'help') {
    await sendDiscordReply(channelId,
      `🏷️ **Chat Tag Commands:**\n` +
      `@spmt join — Join the game\n` +
      `@spmt tag @user — Tag someone\n` +
      `@spmt pass @user — Use earned pass (2x pts)\n` +
      `@spmt status — Who's it?\n` +
      `@spmt score — Your stats\n` +
      `@spmt rank — Top 3\n` +
      `@spmt sleep / wake — Toggle immunity\n` +
      `@spmt help — This message\n` +
      `Or use the buttons below the game embed! 👇`
    , userMessageId);
  }

  else if (cmd === 'card' || cmd === 'claim' || cmd === 'phrases') {
    // Bingo commands — point to buttons
    await sendDiscordReply(channelId,
      `🎲 Use the **Bingo** button on the game embed for the full interactive card!`
    , userMessageId);
  }

  else if (cmd === 'givepass') {
    const target = parts[1]?.replace('@', '').toLowerCase();
    if (!target) {
      await sendDiscordReply(channelId, `❌ Usage: spmt givepass @username`, userMessageId);
      return;
    }
    const playersData = await tagApi('/api/tag');
    const targetPlayer = playersData?.players?.find((p: any) =>
      (p.twitchUsername || p.username)?.toLowerCase() === target
    );
    if (!targetPlayer) {
      await sendDiscordReply(channelId, `❌ ${target} is not in the game!`, userMessageId);
      return;
    }
    const res = await postTagApi('/api/tag', {
      action: 'grant-pass',
      userId: targetPlayer.id,
      twitchUsername: target,
      reason: `gifted by ${displayName} (discord)`,
    });
    if (res?.granted) {
      await sendDiscordReply(channelId, `🎟️ @${target} got a Pass from ${displayName}! Use "spmt pass @username" to tag anyone for DOUBLE POINTS!`, userMessageId);
    } else if (res?.reason === 'max-passes') {
      await sendDiscordReply(channelId, `❌ ${target} already has the max 3/3 passes!`, userMessageId);
    } else {
      await sendDiscordReply(channelId, `❌ Could not give pass to ${target}.`, userMessageId);
    }
  }

  else if (cmd === 'players') {
    const data = await tagApi('/api/tag');
    const players = data?.players || [];
    const names = players.map((p: any) => p.twitchUsername || p.username).filter(Boolean);
    const list = names.length > 0 ? names.slice(0, 30).join(', ') : 'none';
    const more = names.length > 30 ? ` (+${names.length - 30} more)` : '';
    await sendDiscordReply(channelId, `👥 ${players.length} players: ${list}${more}`, userMessageId);
  }

  else if (cmd === 'live') {
    const liveData = await tagApi('/api/discord/live-members');
    const playersData = await tagApi('/api/tag');
    const players = playersData?.players || [];
    const rawLive = liveData?.liveMembers || [];
    console.log(`[ChatTag-live] API returned ${rawLive.length} live members, ${players.length} players`);
    if (rawLive.length > 0) console.log(`[ChatTag-live] First live: ${rawLive[0]?.twitchUsername}`);
    const playerSet = new Set(players.map((p: any) => (p.twitchUsername || p.username)?.toLowerCase()).filter(Boolean));
    const liveMembers = rawLive.filter((m: any) => playerSet.has(m.twitchUsername?.toLowerCase()));
    console.log(`[ChatTag-live] After filter: ${liveMembers.length} live players`);
    const liveLogins = new Set(liveMembers.map((m: any) => (m.twitchUsername || '').toLowerCase()));

    const now = Date.now();
    const ACTIVE_THRESHOLD = 40 * 60 * 1000;

    const channelChatters: Record<string, string[]> = {};
    const discordActive: string[] = [];

    for (const p of players) {
      const pName = (p.twitchUsername || p.username || '').toLowerCase();
      if (liveLogins.has(pName)) continue;
      const lastChat = p.lastChatAt || 0;
      if ((now - lastChat) > ACTIVE_THRESHOLD) continue;
      const ch = (p.lastSeenChannel || '').toLowerCase();
      if (ch === 'discord') {
        discordActive.push(pName);
      } else if (ch && liveLogins.has(ch)) {
        if (!channelChatters[ch]) channelChatters[ch] = [];
        channelChatters[ch].push(pName);
      }
    }

    const outputLines: string[] = [];
    let totalChatters = 0;
    for (const m of liveMembers) {
      const login = (m.twitchUsername || '').toLowerCase();
      const chatters = channelChatters[login] || [];
      totalChatters += chatters.length;
      const chatterStr = chatters.length > 0 ? ` > \uD83D\uDCAC${chatters.join(', ')}` : '';
      outputLines.push(`\uD83D\uDFE2${login}${chatterStr}`);
    }
    if (discordActive.length > 0) {
      totalChatters += discordActive.length;
      outputLines.push(`\uD83D\uDFE3Discord > \uD83D\uDCAC${discordActive.join(', ')}`);
    }

    if (outputLines.length === 0) {
      await sendDiscordReply(channelId, `\u274C No players are live or active right now!`, userMessageId);
      return;
    }

    await sendDiscordReply(channelId,
      `\uD83D\uDFE2${liveMembers.length} live \uD83D\uDCAC${totalChatters} chatting:\n${outputLines.join('\n')}`,
      userMessageId
    );
  }
  else if (cmd === 'stats') {
    const data = await tagApi('/api/tag');
    const player = twitchLogin
      ? data?.players?.find((p: any) => (p.twitchUsername || '').toLowerCase() === twitchLogin.toLowerCase())
      : null;
    if (!player) {
      await sendDiscordReply(channelId, `❌ ${displayName}: You're not in the game! Use spmt join`, userMessageId);
      return;
    }
    await sendDiscordReply(channelId, `📊 ${displayName} — Tags: ${player.tags || 0} | Tagged: ${player.tagged || 0}`, userMessageId);
  }

  else if (cmd === 'rules') {
    await sendDiscordReply(channelId, `📜 Tag someone with "spmt tag @user" in their chat. If you're it, tag someone else! "spmt sleep" = go immune. "spmt pass @user" = earned double-points tag. Full guide: ${CHAT_TAG_API}/about`, userMessageId);
  }

  else if (cmd === 'newcard') {
    const res = await tagApi('/api/bingo/generate', { method: 'POST' });
    const note = res?.aiGenerated ? '(AI-generated!)' : '(shuffled phrases)';
    await sendDiscordReply(channelId, `✅ New bingo card generated ${note}!`, userMessageId);
  }

  else if (cmd === 'pinrank') {
    const pinData = await tagApi('/api/tag/pin-stats');
    if (!pinData?.topTagged || pinData.topTagged.length === 0) {
      await sendDiscordReply(channelId, `❌ Pin hasn't tagged anyone yet!`, userMessageId);
      return;
    }
    const top5 = pinData.topTagged.slice(0, 5).map((entry: any, i: number) =>
      `#${i + 1} ${entry.username}: ${entry.count}`
    ).join(' | ');
    await sendDiscordReply(channelId, `📌 Pin's Top 5: ${top5}`, userMessageId);
  }

  else {
    await sendDiscordReply(
      channelId,
      `❌ ${displayName}: Unknown Chat Tag command \`spmt ${cmd}\`. Try \`spmt help\` or \`spmt controls\`.`,
      userMessageId
    );
  }
}

// ── Embed builders ──

export function buildGameStateEmbed(gameState: any, serverId: string): any {
  const tag = gameState.tag;
  const players = gameState.players || [];
  const leaderboard = gameState.leaderboard || [];
  const history = gameState.recentHistory || [];


  const itLine = tag.currentIt
    ? `🎯 **${tag.currentIt.twitchUsername}** is IT`
    : `🔥 **FREE FOR ALL** — Anyone can tag for DOUBLE POINTS!`;

  const elapsed = tag.lastTagTime ? Math.floor((Date.now() - tag.lastTagTime) / 60000) : 0;
  const timeLine = tag.lastTagTime ? `⏱️ ${elapsed} min ago` : '';

  const recentLines = history.slice(0, 5).map((h: any) => {
    const icon = h.blocked ? '🛡️' : h.doublePoints ? '🔥' : '🎯';
    if (h.blocked) return `${icon} ${h.taggerUsername} → ${h.taggedUsername} (blocked: ${h.blocked})`;
    return `${icon} ${h.taggerUsername} tagged ${h.taggedUsername}${h.doublePoints ? ' (2x!)' : ''}`;
  }).join('\n') || 'No recent tags';

  const filteredLeaderboard = leaderboard.filter((p: any) => (p.twitchUsername || '').toLowerCase() !== 'mtman1987');

  const top3Lines = filteredLeaderboard.slice(0, 3).map((p: any, i: number) =>
    `**#${i + 1}** ${p.twitchUsername} — ${p.score} pts (${p.tags} tags)`
  ).join('\n') || 'No players yet';





  return {
    embeds: [{
      title: '🏷️ SPMT Chat Tag',
      description: `${itLine}\n${timeLine}`,
      color: tag.isFreeForAll ? 0xFF4500 : 0x00D9FF,
      fields: [
        { name: '📜 Recent', value: recentLines, inline: false },
        { name: '🏆 Top 3', value: top3Lines, inline: true },
        { name: '📺 Overlay', value: '[Add to OBS](https://tinyurl.com/spmt-overlay)', inline: true },
      ],
      footer: { text: `${tag.playerCount} players • Type spmt help for commands` },
      timestamp: new Date().toISOString(),
    }],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: 'Join Game', custom_id: `chattag_join_${serverId}` },
          { type: 2, style: 1, label: 'Status', custom_id: `chattag_status_${serverId}` },
          { type: 2, style: 1, label: 'My Score', custom_id: `chattag_score_${serverId}` },
          { type: 2, style: 4, label: 'Away', custom_id: `chattag_togglesleep_${serverId}` },
          { type: 2, style: 2, label: 'Admin', custom_id: `chattag_admin_${serverId}` },
        ],
      },
    ],
  };
}

export function buildScoreEmbed(player: any, rank: number, totalPlayers: number): string {
  if (!player) return `❌ You're not in the game! Type \`@spmt join\` in chat to play.`;
  return (
    `📊 **${player.twitchUsername}**\n\n` +
    `🏅 Rank: **#${rank}** / ${totalPlayers}\n` +
    `⭐ Score: **${player.score || 0}** pts\n` +
    `🎯 Tags Made: **${player.tags || 0}**\n` +
    `💀 Times Tagged: **${player.tagged || 0}**\n` +
    `🎟️ Pass: ${player.hasPass ? '✅ Ready' : '❌ None'}\n` +
    `${player.isIt ? '👉 **YOU ARE IT!**' : ''}` +
    `${player.sleepingImmunity ? '\n😴 Sleeping (immune)' : ''}`
  );
}

export function buildBingoComponents(bingo: any, serverId: string): any {
  if (!bingo?.phrases?.length) {
    return { content: '🎲 No bingo card active right now.', flags: 64 };
  }

  const covered = bingo.covered || {};
  const rows: any[] = [];

  for (let row = 0; row < 5; row++) {
    const buttons: any[] = [];
    for (let col = 0; col < 5; col++) {
      const idx = row * 5 + col;
      const isClaimed = !!covered[idx];
      buttons.push({
        type: 2,
        style: isClaimed ? 3 : 2, // green if claimed, grey if not
        label: `${isClaimed ? '✅' : '⬜'} ${idx}`,
        custom_id: `chattag_claim_${serverId}_${idx}`,
        disabled: isClaimed,
      });
    }
    rows.push({ type: 1, components: buttons });
  }

  const claimedCount = Object.keys(covered).length;
  return {
    content: `🎲 **Bingo Card** — ${claimedCount}/25 claimed\nClick a square to claim it!`,
    components: rows,
    flags: 64,
  };
}

export function buildBingoPhrasesList(bingo: any): string {
  if (!bingo?.phrases?.length) return 'No bingo card active.';
  const covered = bingo.covered || {};
  return bingo.phrases.map((phrase: string, i: number) =>
    `${covered[i] ? '✅' : '⬜'} **${i}**: ${phrase}`
  ).join('\n');
}

export function buildAdminEmbed(gameState: any, serverId: string): any {
  const tag = gameState.tag;
  const playerCount = tag.playerCount || 0;
  const itName = tag.currentIt?.twitchUsername || 'Nobody (FFA)';

  return {
    content: (
      `🔧 **Admin Panel**\n\n` +
      `🎯 Current IT: **${itName}**\n` +
      `👥 Players: **${playerCount}**\n` +
      `🔥 FFA: ${tag.isFreeForAll ? 'Yes' : 'No'}`

    ),
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 4, label: 'Make Me IT', custom_id: `chattag_makemeit_${serverId}` },
          { type: 2, style: 4, label: 'Clear All Immunity', custom_id: `chattag_clearimmunity_${serverId}` },

          { type: 2, style: 2, label: 'View Logs', custom_id: `chattag_logs_${serverId}` },
        ],
      },
    ],
    flags: 64,
  };
}

// ── Persistent embed compatibility ──

export async function postOrUpdateGameEmbed(serverId: string): Promise<{ action: string; messageId: string }> {
  const secret = getChatTagServiceSecret();
  if (!secret) throw new Error('CHAT_TAG_BOT_SECRET is not configured.');
  const response = await fetch(`${CHAT_TAG_API}/api/discord/announce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-secret': secret },
    body: JSON.stringify({ refreshOnly: true, message: `dsh compatibility refresh for ${serverId}` }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false || payload?.embed?.ok === false) {
    throw new Error(payload?.error || payload?.embed?.error || `Chat Tag returned ${response.status}`);
  }

  return {
    action: payload?.embed?.action || 'refreshed',
    messageId: payload?.embed?.messageId || '',
  };
}

// ── Fetch helpers for interactions ──

export async function fetchGameState(): Promise<any> {
  const secret = getChatTagServiceSecret();
  if (!secret) throw new Error('CHAT_TAG_BOT_SECRET is not configured.');
  return tagApi(`/api/discord/game-state?secret=${secret}`);
}

export async function fetchTagData(): Promise<any> {
  return tagApi('/api/tag');
}

export async function blacklistChatTagChannel(channel: string): Promise<{ added: boolean }> {
  const normalized = String(channel || '').trim().toLowerCase().replace(/^#/, '');
  const secret = getChatTagServiceSecret();
  if (!normalized) throw new Error('Chat Tag blacklist channel is required.');
  if (!secret) throw new Error('CHAT_TAG_BOT_SECRET is not configured.');

  const response = await fetch(`${CHAT_TAG_API}/api/bot/blacklist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-secret': secret },
    body: JSON.stringify({ channel: normalized, source: 'twitch-msg-banned' }),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || `Chat Tag blacklist returned ${response.status}`);
  }
  return { added: payload?.added !== false };
}

export async function fetchBingoState(): Promise<any> {
  return tagApi('/api/bingo/state');
}

export async function claimBingoSquare(squareIndex: number, userId: string, username: string): Promise<any> {
  return postTagApi('/api/bingo/state', {
    action: 'claim',
    squareIndex,
    userId,
    username,
    avatar: '',
    streamerChannel: 'discord',
  });
}

export async function setMeAsIt(userId: string): Promise<any> {
  return postTagApi('/api/tag', { action: 'set-it', userId });
}

export async function clearAllImmunity(): Promise<any> {
  return postTagApi('/api/tag', { action: 'clear-all-away', performedBy: 'discord-admin' });
}

export async function generateNewBingoCard(): Promise<any> {
  return tagApi('/api/bingo/generate', { method: 'POST' });
}

export async function fetchLogs(): Promise<string> {
  try {
    const res = await fetch(`${CHAT_TAG_API}/api/logs`);
    if (!res.ok) return 'Failed to fetch logs.';
    const text = await res.text();
    // Truncate to fit Discord's 2000 char limit for code blocks
    return text.slice(-1800) || 'No logs available.';
  } catch {
    return 'Failed to fetch logs.';
  }
}

export { CHAT_TAG_CHANNEL_ID };
