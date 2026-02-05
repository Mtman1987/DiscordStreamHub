'use client';

import * as React from 'react';
import { PageHeader } from '@/components/page-header';
import { SettingsClientComponents } from './page-client';

export default function SettingsPage() {
  const [guildId, setGuildId] = React.useState('');

  React.useEffect(() => {
    const storedGuildId = localStorage.getItem('discordServerId');
    if (storedGuildId) {
      setGuildId(storedGuildId);
    }
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Configure your server identity, integrations, and monitoring."
      />
      {guildId ? (
        <SettingsClientComponents serverId={guildId} />
      ) : (
        <div className="text-center text-muted-foreground py-8">
          Loading server configuration...
        </div>
      )}
    </div>
  );
}
