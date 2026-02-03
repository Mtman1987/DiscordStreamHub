'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function QuickSetupPage() {
  const [serverId, setServerId] = useState('1240832965865635881');
  const [channels, setChannels] = useState({
    crew: '',
    partners: '',
    community: '',
    raidPile: ''
  });
  const [status, setStatus] = useState('');

  const handleSetup = async () => {
    setStatus('Setting up...');
    
    const response = await fetch('/api/setup/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId,
        crewChannelId: channels.crew,
        partnersChannelId: channels.partners,
        communityChannelId: channels.community,
        raidPileChannelId: channels.raidPile
      })
    });

    if (response.ok) {
      setStatus('✅ Setup complete! You can now enable polling.');
    } else {
      setStatus('❌ Setup failed. Check console.');
    }
  };

  const handleEnablePolling = async () => {
    setStatus('Enabling polling...');
    
    const response = await fetch('/api/setup/enable-polling', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId })
    });

    if (response.ok) {
      setStatus('✅ Polling enabled! System is now active.');
    } else {
      setStatus('❌ Failed to enable polling.');
    }
  };

  return (
    <div className="container mx-auto p-8 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Quick Setup</CardTitle>
          <CardDescription>Configure your Discord channels and enable polling</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Server ID</Label>
            <Input value={serverId} onChange={(e) => setServerId(e.target.value)} />
          </div>

          <div>
            <Label>Crew Channel ID</Label>
            <Input value={channels.crew} onChange={(e) => setChannels({...channels, crew: e.target.value})} />
          </div>

          <div>
            <Label>Partners Channel ID</Label>
            <Input value={channels.partners} onChange={(e) => setChannels({...channels, partners: e.target.value})} />
          </div>

          <div>
            <Label>Community Channel ID</Label>
            <Input value={channels.community} onChange={(e) => setChannels({...channels, community: e.target.value})} />
          </div>

          <div>
            <Label>Raid Pile Channel ID</Label>
            <Input value={channels.raidPile} onChange={(e) => setChannels({...channels, raidPile: e.target.value})} />
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSetup}>Setup Channels</Button>
            <Button onClick={handleEnablePolling} variant="secondary">Enable Polling</Button>
          </div>

          {status && <p className="text-sm">{status}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
