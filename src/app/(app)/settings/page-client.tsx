'use client';

import * as React from 'react';
import { ServerBrandingCard } from './_components/server-branding-card';
import { TwitchLinkingCard } from './_components/twitch-linking-card';
import { TwitchBotLinkingCard } from './_components/twitch-bot-linking-card';
import { TwitchOAuthCard } from './_components/twitch-oauth-card';
import { TwitchPollingSettings } from './_components/twitch-polling-settings';
import { MemberProcessingCard } from './_components/member-processing-card';
import { EnhancedEmbedEditor } from './_components/enhanced-embed-editor';
import { PartnerScheduleSettings } from './_components/partner-schedule-settings';
import { AdminRoleSettings } from './_components/admin-role-settings';
import { DiscordSyncSettings } from './_components/discord-sync-settings';
import { DiscordOAuthCard } from './_components/discord-oauth-card';
import { ForwardingForumsSettings } from './_components/forwarding-forums-settings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Tv, Palette, Users, Zap, Calendar, Forward, Rocket, ChevronRight, ChevronLeft } from 'lucide-react';

export function SettingsClientComponents({ serverId }: { serverId: string }) {
  const [showWizard, setShowWizard] = React.useState(false);
  const [wizardStep, setWizardStep] = React.useState(0);

  React.useEffect(() => {
    const hasSetup = localStorage.getItem('setupComplete');
    if (!hasSetup) setShowWizard(true);
  }, []);

  const wizardSteps = [
    { title: 'Server Identity', desc: 'Set your server name and community member names', tab: 'identity', icon: <Sparkles className="h-8 w-8 text-primary" /> },
    { title: 'Twitch Integration', desc: 'Connect your personal and bot Twitch accounts', tab: 'twitch', icon: <Tv className="h-8 w-8 text-purple-500" /> },
    { title: 'Shoutout Templates', desc: 'Customize how shoutouts look in Discord', tab: 'embeds', icon: <Palette className="h-8 w-8 text-cyan-500" /> },
    { title: 'Discord Sync & Members', desc: 'Sync your server, configure channels and roles', tab: 'members', icon: <Users className="h-8 w-8 text-green-500" /> },
    { title: 'Start Monitoring', desc: 'Activate automatic stream polling', tab: 'polling', icon: <Zap className="h-8 w-8 text-yellow-500" /> },
  ];

  const finishWizard = () => {
    localStorage.setItem('setupComplete', 'true');
    setShowWizard(false);
  };

  return (
    <>
      <Dialog open={showWizard} onOpenChange={setShowWizard}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Rocket className="h-5 w-5" />Setup Wizard — Step {wizardStep + 1} of {wizardSteps.length}</DialogTitle>
            <DialogDescription>Follow these steps to get your bot fully configured.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center py-6 gap-4">
            {wizardSteps[wizardStep].icon}
            <h3 className="text-xl font-bold">{wizardSteps[wizardStep].title}</h3>
            <p className="text-sm text-muted-foreground text-center">{wizardSteps[wizardStep].desc}</p>
            <p className="text-xs text-muted-foreground">Configure this in the <strong>{wizardSteps[wizardStep].title}</strong> tab below.</p>
          </div>
          <DialogFooter className="flex justify-between sm:justify-between">
            <Button variant="outline" onClick={() => setWizardStep(s => Math.max(0, s - 1))} disabled={wizardStep === 0}>
              <ChevronLeft className="h-4 w-4 mr-1" />Back
            </Button>
            {wizardStep < wizardSteps.length - 1 ? (
              <Button onClick={() => setWizardStep(s => s + 1)}>
                Next<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={finishWizard}>
                <Rocket className="h-4 w-4 mr-1" />Finish Setup
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between mb-4">
        <div />
        <Button variant="outline" size="sm" onClick={() => { setWizardStep(0); setShowWizard(true); }}>
          <Rocket className="h-3 w-3 mr-2" />Setup Wizard
        </Button>
      </div>

      <Tabs defaultValue="identity" className="space-y-6">
      <TabsList className="grid w-full grid-cols-3 lg:grid-cols-7 h-auto gap-1">
        <TabsTrigger value="identity" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
          <Sparkles className="h-3.5 w-3.5" />Identity
        </TabsTrigger>
        <TabsTrigger value="twitch" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
          <Tv className="h-3.5 w-3.5" />Twitch
        </TabsTrigger>
        <TabsTrigger value="embeds" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
          <Palette className="h-3.5 w-3.5" />Embeds
        </TabsTrigger>
        <TabsTrigger value="members" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
          <Users className="h-3.5 w-3.5" />Members
        </TabsTrigger>
        <TabsTrigger value="polling" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
          <Zap className="h-3.5 w-3.5" />Polling
        </TabsTrigger>
        <TabsTrigger value="schedules" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
          <Calendar className="h-3.5 w-3.5" />Schedules
        </TabsTrigger>
        <TabsTrigger value="forwarding" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
          <Forward className="h-3.5 w-3.5" />Forwarding
        </TabsTrigger>
      </TabsList>

      <TabsContent value="identity" className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-lg font-semibold mb-1">Server Identity</h3>
          <p className="text-sm text-muted-foreground mb-4">Set your server name and community member names. These appear in all shoutouts and messages.</p>
        </div>
        <ServerBrandingCard serverId={serverId} />
      </TabsContent>

      <TabsContent value="twitch" className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-lg font-semibold mb-1">Twitch Integration</h3>
          <p className="text-sm text-muted-foreground mb-4">Connect the Twitch accounts used for linking and chat-side integrations.</p>
        </div>
        <TwitchLinkingCard serverId={serverId} />
        <TwitchOAuthCard serverId={serverId} />
      </TabsContent>

      <TabsContent value="embeds" className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-lg font-semibold mb-1">Shoutout Templates</h3>
          <p className="text-sm text-muted-foreground mb-4">Customize colors, text, and formatting for Crew, Partner, and Community shoutouts.</p>
        </div>
        <EnhancedEmbedEditor serverId={serverId} />
      </TabsContent>

      <TabsContent value="members" className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-lg font-semibold mb-1">Discord Sync & Members</h3>
          <p className="text-sm text-muted-foreground mb-4">Sync your server, configure channels and roles, manage member Twitch links.</p>
        </div>
        <DiscordOAuthCard serverId={serverId} />
        <DiscordSyncSettings serverId={serverId} />
        <MemberProcessingCard serverId={serverId} />
        <AdminRoleSettings serverId={serverId} />
      </TabsContent>

      <TabsContent value="polling" className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-lg font-semibold mb-1">Stream Monitoring</h3>
          <p className="text-sm text-muted-foreground mb-4">Control the automatic polling service that monitors Twitch streams and posts shoutouts.</p>
        </div>
        <TwitchPollingSettings />
      </TabsContent>

      <TabsContent value="schedules" className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-lg font-semibold mb-1">Partner Schedules</h3>
          <p className="text-sm text-muted-foreground mb-4">Deploy Twitch schedule calendars to partner threads in Discord.</p>
        </div>
        <PartnerScheduleSettings serverId={serverId} />
      </TabsContent>
      <TabsContent value="forwarding" className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-lg font-semibold mb-1">Message Forwarding</h3>
          <p className="text-sm text-muted-foreground mb-4">Configure a source Discord server and a destination Discord server explicitly. The form below does not depend on the current app session.</p>
        </div>
        <ForwardingForumsSettings />
      </TabsContent>
    </Tabs>
    </>
  );
}
