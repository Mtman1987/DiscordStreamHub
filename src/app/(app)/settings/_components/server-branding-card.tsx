'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, Sparkles } from 'lucide-react';
import { doc } from 'firebase/firestore';
import { useDoc, useFirestore } from '@/firebase';

interface ServerBranding {
  serverName: string;
  communityMemberName: string;
  communityMemberNamePlural: string;
}

const DEFAULT_BRANDING: ServerBranding = {
  serverName: 'Space Mountain',
  communityMemberName: 'Mountaineer',
  communityMemberNamePlural: 'Mountaineers'
};

export function ServerBrandingCard({ serverId }: { serverId: string }) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const [isSaving, setIsSaving] = React.useState(false);
  const [branding, setBranding] = React.useState<ServerBranding>(DEFAULT_BRANDING);

  const brandingRef = React.useMemo(() => {
    if (!firestore || !serverId) return null;
    return doc(firestore, 'servers', serverId, 'config', 'branding');
  }, [firestore, serverId]);

  const { data: savedBranding } = useDoc<ServerBranding>(brandingRef);

  React.useEffect(() => {
    if (savedBranding) {
      setBranding({ ...DEFAULT_BRANDING, ...savedBranding });
    }
  }, [savedBranding]);

  const handleSave = async () => {
    if (!brandingRef) return;
    setIsSaving(true);
    try {
      const { setDoc } = await import('firebase/firestore');
      await setDoc(brandingRef, branding);
      toast({ title: 'Branding saved!', description: 'Your server branding has been updated.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save branding.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          Server Branding
        </CardTitle>
        <CardDescription>
          Customize how your server name appears throughout the app. Space Mountain defaults are pre-filled.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Server Name</Label>
          <Input 
            value={branding.serverName} 
            onChange={(e) => setBranding({...branding, serverName: e.target.value})}
            placeholder="Space Mountain"
          />
          <p className="text-xs text-muted-foreground">Used in shoutouts, raid pile, and community messages</p>
        </div>

        <div className="space-y-2">
          <Label>Community Member Name (Singular)</Label>
          <Input 
            value={branding.communityMemberName} 
            onChange={(e) => setBranding({...branding, communityMemberName: e.target.value})}
            placeholder="Mountaineer"
          />
          <p className="text-xs text-muted-foreground">What you call individual community members</p>
        </div>

        <div className="space-y-2">
          <Label>Community Member Name (Plural)</Label>
          <Input 
            value={branding.communityMemberNamePlural} 
            onChange={(e) => setBranding({...branding, communityMemberNamePlural: e.target.value})}
            placeholder="Mountaineers"
          />
          <p className="text-xs text-muted-foreground">What you call multiple community members</p>
        </div>

        <Button onClick={handleSave} disabled={isSaving} className="w-full">
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Branding
        </Button>
      </CardContent>
    </Card>
  );
}
