'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, Eye } from 'lucide-react';
import { doc } from 'firebase/firestore';
import { useDoc, useFirestore } from '@/firebase';
import { getChannels } from '@/lib/discord-sync-service';

interface EmbedTemplates {
  crew: {
    title: string;
    description: string;
    badge: string;
    footer: string;
  };
  partners: {
    title: string;
    description: string;
    badge: string;
    footer: string;
  };
  community: {
    title: string;
    footer: string;
  };
}

const DEFAULT_TEMPLATES: EmbedTemplates = {
  crew: {
    title: '🎬 {username} is LIVE!',
    description: '🌟 **Space Mountain Crew Member** 🌟\n\nOne of our amazing crew members is live! They help keep Space Mountain running smoothly. Show them some love and join the stream!',
    badge: 'Space Mountain Crew',
    footer: 'Twitch • Space Mountain Crew Shoutout'
  },
  partners: {
    title: '🎬 {username} is LIVE!',
    description: '⭐ **Space Mountain Partner** ⭐\n\nOne of our official streaming partners is live! They\'re a valued member of the Space Mountain community. Show them some love and join the stream!',
    badge: 'Official Space Mountain Partner',
    footer: 'Twitch • Space Mountain Partner Shoutout'
  },
  community: {
    title: '🎬 {username} is LIVE!',
    footer: 'Twitch • Mountaineer Shoutout'
  }
};

export function EmbedTemplatesCard({ serverId }: { serverId: string }) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const [isSaving, setIsSaving] = React.useState(false);
  const [isPreviewing, setIsPreviewing] = React.useState<string | null>(null);
  const [templates, setTemplates] = React.useState<EmbedTemplates>(DEFAULT_TEMPLATES);
  const [channels, setChannels] = React.useState<any[]>([]);
  const [selectedChannel, setSelectedChannel] = React.useState('');

  React.useEffect(() => {
    if (serverId) {
      getChannels(serverId).then(setChannels).catch(console.error);
    }
  }, [serverId]);

  const templatesRef = React.useMemo(() => {
    if (!firestore || !serverId) return null;
    return doc(firestore, 'servers', serverId, 'config', 'embedTemplates');
  }, [firestore, serverId]);

  const { data: savedTemplates } = useDoc<EmbedTemplates>(templatesRef);

  React.useEffect(() => {
    if (savedTemplates) {
      setTemplates(savedTemplates);
    }
  }, [savedTemplates]);

  const handleSave = async () => {
    if (!templatesRef) return;
    setIsSaving(true);
    try {
      const { setDoc } = await import('firebase/firestore');
      await setDoc(templatesRef, templates);
      toast({ title: 'Templates saved!', description: 'Your embed templates have been updated.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save templates.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = async (type: 'crew' | 'partners' | 'community') => {
    if (!selectedChannel) {
      toast({ variant: 'destructive', title: 'Channel Required', description: 'Please select a channel first.' });
      return;
    }
    setIsPreviewing(type);
    try {
      const response = await fetch('/api/discord/preview-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, channelId: selectedChannel, type, templates })
      });
      if (response.ok) {
        toast({ title: 'Preview Posted', description: 'Template preview sent to Discord.' });
      } else {
        const error = await response.json();
        toast({ variant: 'destructive', title: 'Preview Failed', description: error.error || 'Failed to post preview.' });
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to post preview.' });
    } finally {
      setIsPreviewing(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shoutout Embed Templates</CardTitle>
        <CardDescription>
          Customize how shoutouts appear in Discord. Use {'{username}'} as a placeholder.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Preview Channel</Label>
          <Select value={selectedChannel} onValueChange={setSelectedChannel}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a channel for previews" />
            </SelectTrigger>
            <SelectContent>
              {channels.map(channel => (
                <SelectItem key={channel.id} value={channel.id}>
                  #{channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-4">
          <h3 className="font-semibold">Crew Members</h3>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={templates.crew.title} onChange={(e) => setTemplates({...templates, crew: {...templates.crew, title: e.target.value}})} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={templates.crew.description} onChange={(e) => setTemplates({...templates, crew: {...templates.crew, description: e.target.value}})} rows={3} />
          </div>
          <div className="space-y-2">
            <Label>Badge Text</Label>
            <Input value={templates.crew.badge} onChange={(e) => setTemplates({...templates, crew: {...templates.crew, badge: e.target.value}})} />
          </div>
          <div className="space-y-2">
            <Label>Footer</Label>
            <Input value={templates.crew.footer} onChange={(e) => setTemplates({...templates, crew: {...templates.crew, footer: e.target.value}})} />
          </div>
          <Button variant="outline" onClick={() => handlePreview('crew')} disabled={isPreviewing === 'crew' || !selectedChannel} className="w-full">
            {isPreviewing === 'crew' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
            Preview Crew Template
          </Button>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold">Partners</h3>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={templates.partners.title} onChange={(e) => setTemplates({...templates, partners: {...templates.partners, title: e.target.value}})} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={templates.partners.description} onChange={(e) => setTemplates({...templates, partners: {...templates.partners, description: e.target.value}})} rows={3} />
          </div>
          <div className="space-y-2">
            <Label>Badge Text</Label>
            <Input value={templates.partners.badge} onChange={(e) => setTemplates({...templates, partners: {...templates.partners, badge: e.target.value}})} />
          </div>
          <div className="space-y-2">
            <Label>Footer</Label>
            <Input value={templates.partners.footer} onChange={(e) => setTemplates({...templates, partners: {...templates.partners, footer: e.target.value}})} />
          </div>
          <Button variant="outline" onClick={() => handlePreview('partners')} disabled={isPreviewing === 'partners' || !selectedChannel} className="w-full">
            {isPreviewing === 'partners' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
            Preview Partners Template
          </Button>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold">Community Members</h3>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={templates.community.title} onChange={(e) => setTemplates({...templates, community: {...templates.community, title: e.target.value}})} />
          </div>
          <div className="space-y-2">
            <Label>Footer</Label>
            <Input value={templates.community.footer} onChange={(e) => setTemplates({...templates, community: {...templates.community, footer: e.target.value}})} />
          </div>
          <Button variant="outline" onClick={() => handlePreview('community')} disabled={isPreviewing === 'community' || !selectedChannel} className="w-full">
            {isPreviewing === 'community' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
            Preview Community Template
          </Button>
        </div>

        <Button onClick={handleSave} disabled={isSaving} className="w-full">
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Templates
        </Button>
      </CardContent>
    </Card>
  );
}
