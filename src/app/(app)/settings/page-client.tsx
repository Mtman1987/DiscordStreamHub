import { TwitchLinkingCard } from './_components/twitch-linking-card.tsx';
import { TwitchBotLinkingCard } from './_components/twitch-bot-linking-card';
import { TwitchPollingSettings } from './_components/twitch-polling-settings';
import { MemberProcessingCard } from './_components/member-processing-card';
import { EmbedTemplatesCard } from './_components/embed-templates-card';

export function SettingsClientComponents({ serverId }: { serverId: string }) {
  return (
    <div className="space-y-8">
      <TwitchLinkingCard serverId={serverId} />
      <TwitchBotLinkingCard serverId={serverId} />
      <TwitchPollingSettings />
      <MemberProcessingCard serverId={serverId} />
      <EmbedTemplatesCard serverId={serverId} />
    </div>
  );
}
