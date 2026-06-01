'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Save, Trash2, Forward } from 'lucide-react';

interface Mapping {
  sourceChannelId: string;
  threadId: string;
  label: string; // friendly name for display
}

export function ForwardingForumsSettings({ serverId }: { serverId: string }) {
  const { toast } = useToast();
  const [mappings, setMappings] = React.useState<Mapping[]>([]);
  const [forumChannelId, setForumChannelId] = React.useState('');
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
        setForumChannelId(data.forumChannelId || '');
        const raw = data.mappings || {};
        const labels = data.labels || {};
        const loaded: Mapping[] = Object.entries(raw).map(([sourceChannelId, threadId]) => ({
          sourceChannelId,
          threadId: threadId as string,
          label: (labels as Record<string, string>)[sourceChannelId] || '',
        }));
        setMappings(loaded.length > 0 ? loaded : [{ sourceChannelId: '', threadId: '', label: '' }]);
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
        if (m.sourceChannelId && m.threadId) {
          mappingsObj[m.sourceChannelId] = m.threadId;
          if (m.label) labelsObj[m.sourceChannelId] = m.label;
        }
      }
      const res = await fetch('/api/settings/forwarding-forums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, forumChannelId: forumChannelId.trim(), mappings: mappingsObj, labels: labelsObj }),
      });
      if (!res.ok) throw new Error();
      toast({ title: 'Saved', description: 'Forwarding forum mappings updated.' });
    } catch {
      toast({ variant: 'destructive', title: 'Failed to save' });
    } finally {
      setIsSaving(false);
    }
  };

  const addRow = () => setMappings(prev => [...prev, { sourceChannelId: '', threadId: '', label: '' }]);
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
          Map each source Discord channel to a forum post in your server.
          The first message from a channel creates a thread automatically, then later messages keep using the same thread.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground space-y-1">
          <p><strong>Forum Parent Channel ID:</strong> Right-click the forum channel → Copy Channel ID</p>
          <p><strong>Source Channel ID:</strong> Right-click the Discord source channel → Copy Channel ID</p>
          <p><strong>Thread ID:</strong> Right-click the forum thread → Copy Channel ID</p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Forum Parent Channel ID</Label>
          <Input
            placeholder="123456789012345678"
            value={forumChannelId}
            onChange={e => setForumChannelId(e.target.value)}
          />
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
                <Label className="text-xs">Source Channel ID</Label>
                <Input
                  placeholder="123456789012345678"
                  value={m.sourceChannelId}
                  onChange={e => updateRow(i, 'sourceChannelId', e.target.value)}
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
