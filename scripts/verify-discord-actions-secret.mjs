const token = String(process.env.DISCORD_BOT_TOKEN ?? "");
const channelId = String(process.env.DISCORD_TEST_CHANNEL_ID ?? "").trim();

if (!token || token !== token.trim()) {
  throw new Error("DISCORD_BOT_TOKEN is missing or has surrounding whitespace.");
}
if (!/^\d{17,20}$/.test(channelId)) {
  throw new Error("DISCORD_TEST_CHANNEL_ID is missing or is not a Discord channel ID.");
}

const headers = {
  Authorization: `Bot ${token}`,
  "Content-Type": "application/json",
};

async function discordRequest(label, path, body) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseText = await response.text();
  console.log(`[${label}] HTTP ${response.status} ${response.statusText}`);
  if (!response.ok) {
    // Discord's error payload is safe to report; never print request headers.
    console.error(`[${label}] Discord error:`, responseText.slice(0, 1000));
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }
  return responseText ? JSON.parse(responseText) : {};
}

const bot = await discordRequest("token-authentication", "/users/@me");
console.log("AUTHENTICATED: Discord accepted the DSH Actions secret.");
console.log("BOT_ID:", bot.id ?? "(not returned)");
console.log("BOT_USERNAME:", bot.username ?? "(not returned)");

const sent = await discordRequest(
  "dm-channel-send",
  `/channels/${encodeURIComponent(channelId)}/messages`,
  { content: "DSH Actions token verification: this bot token authenticated and sent a test message." },
);
console.log("MESSAGE_SENT: true");
console.log("CHANNEL_ID:", channelId);
console.log("MESSAGE_ID:", sent.id ?? "(not returned)");
