'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Save, Trash2, Forward } from 'lucide-react';

interface Mapping {
  guildId: string;
  threadId: string;
  label: string; // friendly name for display
}

export function ForwardingForumsSettings({ serverId }: { serverId: string }) {
  const { toast } = useToast();
  const [mappings, setMappings] = React.useState<Mapping[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    loadMappings();
  }, [serverId]);

  const loadMappings = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/settings/forwarding-forums?serverId=${serverId}`);
      if (res.ok) {
        const data = await res.json();
        const raw = data.mappings || {};
        const labels = data.labels || {};
        const loaded: Mapping[] = Object.entries(raw).map(([guildId, threadId]) => ({
          guildId,
          threadId: threadId as string,
          label: (labels as Record<string, string>)[guildId] || '',
        }));
        setMappings(loaded.length > 0 ? loaded : [{ guildId: '', threadId: '', label: '' }]);
      }
    } catch {
      toast({ variant: 'destructive', title: 'Failed to load forwarding config' });
    } finally {
      setIsLoading(false);
    }
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const mappingsObj: Record<string, string> = {};
      const labelsObj: Record<string, string> = {};
      for (const m of mappings) {
        if (m.guildId && m.threadId) {
          mappingsObj[m.guildId] = m.threadId;
          if (m.label) labelsObj[m.guildId] = m.label;
        }
      }
      const res = await fetch('/api/settings/forwarding-forums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, mappings: mappingsObj, labels: labelsObj }),
      });
      if (!res.ok) throw new Error();
      toast({ title: 'Saved', description: 'Forwarding forum mappings updated.' });
    } catch {
      toast({ variant: 'destructive', title: 'Failed to save' });
    } finally {
      setIsSaving(false);
    }
  };

  const addRow = () => setMappings(prev => [...prev, { guildId: '', threadId: '', label: '' }]);
  const removeRow = (i: number) => setMappings(prev => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: keyof Mapping, value: string) =>
    setMappings(prev => prev.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)));

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Forward className="h-5 w-5" />
          Forum Forwarding Mappings
        </CardTitle>
        <CardDescription>
          Map each partner&apos;s Discord server (Guild ID) to a forum thread in your server.
          Messages from that guild get forwarded to the matching thread with Reply / React / Remove buttons.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground space-y-1">
          <p><strong>Guild ID:</strong> Right-click the partner&apos;s server icon → Copy Server ID</p>
          <p><strong>Thread ID:</strong> Right-click the forum thread → Copy Channel ID</p>
        </div>

        <div className="space-y-3">
          {mappings.map((m, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Label</Label>
                <Input
                  placeholder="e.g. van_braak"
                  value={m.label}
                  onChange={e => updateRow(i, 'label', e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Guild ID</Label>
                <Input
                  placeholder="123456789012345678"
                  value={m.guildId}
                  onChange={e => updateRow(i, 'guildId', e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Forum Thread ID</Label>
                <Input
                  placeholder="987654321098765432"
                  value={m.threadId}
                  onChange={e => updateRow(i, 'threadId', e.target.value)}
                />
              </div>
              <Button variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={mappings.length <= 1}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" /> Add Partner
          </Button>
          <Button size="sm" onClick={save} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Save Mappings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
