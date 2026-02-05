import { ServerBrandingCard } from './_components/server-branding-card';
import { TwitchLinkingCard } from './_components/twitch-linking-card.tsx';
import { TwitchBotLinkingCard } from './_components/twitch-bot-linking-card';
import { TwitchPollingSettings } from './_components/twitch-polling-settings';
import { MemberProcessingCard } from './_components/member-processing-card';
import { EmbedTemplatesCard } from './_components/embed-templates-card';
import { Separator } from '@/components/ui/separator';

export function SettingsClientComponents({ serverId }: { serverId: string }) {
  return (
    <div className="space-y-8">
      {/* Step 1: Server Identity */}
      <div>
        <h2 className="text-2xl font-bold mb-2">1. Server Identity</h2>
        <p className="text-muted-foreground mb-4">Set your server name and community member names</p>
        <ServerBrandingCard serverId={serverId} />
      </div>

      <Separator />

      {/* Step 2: Twitch Integration */}
      <div>
        <h2 className="text-2xl font-bold mb-2">2. Twitch Integration</h2>
        <p className="text-muted-foreground mb-4">Connect your Twitch accounts for monitoring and chat</p>
        <div className="space-y-4">
          <TwitchLinkingCard serverId={serverId} />
          <TwitchBotLinkingCard serverId={serverId} />
        </div>
      </div>

      <Separator />

      {/* Step 3: Customize Shoutouts */}
      <div>
        <h2 className="text-2xl font-bold mb-2">3. Customize Shoutouts</h2>
        <p className="text-muted-foreground mb-4">Design how shoutouts appear in Discord</p>
        <EmbedTemplatesCard serverId={serverId} />
      </div>

      <Separator />

      {/* Step 4: Member Management */}
      <div>
        <h2 className="text-2xl font-bold mb-2">4. Member Management</h2>
        <p className="text-muted-foreground mb-4">Process Discord members and link Twitch accounts</p>
        <MemberProcessingCard serverId={serverId} />
      </div>

      <Separator />

      {/* Step 5: Start Monitoring */}
      <div>
        <h2 className="text-2xl font-bold mb-2">5. Start Monitoring</h2>
        <p className="text-muted-foreground mb-4">Activate automatic stream monitoring</p>
        <TwitchPollingSettings />
      </div>
    </div>
  );
}
