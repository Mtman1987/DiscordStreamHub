from pathlib import Path
p=Path('scripts/discord-ingress-bot.ts')
s=p.read_text()
old="""    for (const guild of readyClient.guilds.cache.values()) {
      for (const state of guild.voiceStates.cache.values()) {
        if (state.channelId) publishVoicePresence(state).catch((error) => console.warn(`[DiscordIngress] Voice presence seed failed ${guild.id}/${state.id}:`, error));
      }
    }
    void resumePendingMtFixItDeliveries"""
new="""    const publishCurrentVoiceStates = () => {
      for (const guild of readyClient.guilds.cache.values()) {
        for (const state of guild.voiceStates.cache.values()) {
          if (state.channelId) publishVoicePresence(state).catch((error) => console.warn(`[DiscordIngress] Voice presence heartbeat failed ${guild.id}/${state.id}:`, error));
        }
      }
    };
    publishCurrentVoiceStates();
    const voicePresenceHeartbeat = setInterval(publishCurrentVoiceStates, 60_000);
    voicePresenceHeartbeat.unref?.();
    void resumePendingMtFixItDeliveries"""
assert old in s, 'voice presence seed block not found'
p.write_text(s.replace(old,new,1))
print('voice presence heartbeat patch applied')
