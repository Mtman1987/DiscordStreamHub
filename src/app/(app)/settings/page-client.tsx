import { TwitchLinkingCard } from './_components/twitch-linking-card.tsx';
import { TwitchPollingSettings } from './_components/twitch-polling-settings';
import { MemberProcessingCard } from './_components/member-processing-card';

export function SettingsClientComponents({ serverId }: { serverId: string }) {
  return (
    <div className="space-y-8">
      <TwitchLinkingCard serverId={serverId} />
      <TwitchPollingSettings />
      <MemberProcessingCard serverId={serverId} />
    </div>
  );
}
