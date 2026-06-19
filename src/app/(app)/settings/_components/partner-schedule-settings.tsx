'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Calendar, CheckCircle } from 'lucide-react';

interface Partner {
  id: string;
  username: string;
  twitchLogin?: string;
  group: string;
}

interface Channel {
  id: string;
  name: string;
  type: number;
}

export function PartnerScheduleSettings({ serverId }: { serverId: string }) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedPartner, setSelectedPartner] = useState('');
  const [selectedThread, setSelectedThread] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const partnersRes = await fetch(`/api/discord/members?serverId=${serverId}`);
      
      if (partnersRes.ok) {
        const data = await partnersRes.json();
        setPartners(data.filter((m: Partner) => m.group === 'Crew' || m.group === 'Partners'));
      }

      const channelsRes = await fetch(`/api/discord/channels?serverId=${serverId}`);
      if (channelsRes.ok) {
        const data = await channelsRes.json();
        setChannels(data);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  }, [serverId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSendSetup = async () => {
    if (!selectedPartner || !selectedThread) return;

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/partner-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setup',
          userId: selectedPartner,
          serverId,
          threadId: selectedThread
        })
      });

      if (response.ok) {
        setResult({ success: true, message: 'Setup embed sent! Partner can now connect their Twitch.' });
      } else {
        setResult({ success: false, message: 'Failed to send setup embed' });
      }
    } catch (error) {
      setResult({ success: false, message: 'Error sending setup' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-purple-600" />
          <CardTitle>Partner Schedule Calendars</CardTitle>
        </div>
        <CardDescription>
          Deploy Twitch schedule calendars to partner forum threads. Partners can connect their Twitch account to display their stream schedule with custom events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Partner</label>
          <Select value={selectedPartner} onValueChange={setSelectedPartner}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a Crew/Partner member" />
            </SelectTrigger>
            <SelectContent>
              {partners.map(partner => (
                <SelectItem key={partner.id} value={partner.id}>
                  {partner.username} {partner.twitchLogin ? `(@${partner.twitchLogin})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Thread/Channel ID</label>
          <Input 
            placeholder="Paste Discord channel or thread ID"
            value={selectedThread}
            onChange={(e) => setSelectedThread(e.target.value)}
          />
        </div>

        <Button
          onClick={handleSendSetup}
          disabled={!selectedPartner || !selectedThread || loading}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Calendar className="mr-2 h-4 w-4" />
              Send Setup Embed
            </>
          )}
        </Button>

        {result && (
          <Alert variant={result.success ? 'default' : 'destructive'}>
            {result.success && <CheckCircle className="h-4 w-4" />}
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        )}

        <div className="text-sm text-gray-500 space-y-1 pt-4 border-t">
          <p><strong>How it works:</strong></p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>Select a partner and their forum thread</li>
            <li>Click &quot;Send Setup Embed&quot; - posts a button in their thread</li>
            <li>Partner clicks &quot;🔗 Connect Twitch Schedule&quot;</li>
            <li>They authorize with Twitch (schedule scope)</li>
            <li>Calendar auto-posts with 🔄 Refresh and ➕ Add Event buttons</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
