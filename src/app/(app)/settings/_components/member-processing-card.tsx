'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Users, Link, MessageSquare, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ProcessedMemberData {
  totalMembers: number;
  linkedMembers: number;
  unmatchedMembers: number;
  groupCounts: {
    VIP: number;
    'Raid Pile': number;
    'Everyone Else': number;
  };
  unmatchedUsers: Array<{
    discordUserId: string;
    username: string;
    displayName: string;
  }>;
}

export function MemberProcessingCard({ serverId }: { serverId: string }) {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [processedData, setProcessedData] = React.useState<ProcessedMemberData | null>(null);
  const [isGeneratingEmbed, setIsGeneratingEmbed] = React.useState<string | null>(null);

  const handleProcessMembers = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch('/api/discord/process-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, action: 'process' })
      });

      if (response.ok) {
        const result = await response.json();
        setProcessedData(result.data);
        toast({
          title: "Members Processed",
          description: `Found ${result.data.totalMembers} total members, ${result.data.linkedMembers} linked to Twitch.`,
        });
      } else {
        const error = await response.json();
        toast({
          title: "Processing Failed",
          description: error.error || "Failed to process members.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process members.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateEmbed = async (type: 'unmatched' | 'vip' | 'raid-pile' | 'everyone-else') => {
    setIsGeneratingEmbed(type);
    try {
      let action: string;
      let group: string | undefined;

      if (type === 'unmatched') {
        action = 'unmatched-embed';
      } else {
        action = 'template-embed';
        group = type === 'vip' ? 'VIP' : type === 'raid-pile' ? 'Raid Pile' : 'Everyone Else';
      }

      const response = await fetch('/api/discord/process-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, action, ...(group && { group }) })
      });

      if (response.ok) {
        const result = await response.json();
        // Copy embed data to clipboard for manual use
        await navigator.clipboard.writeText(JSON.stringify(result.embed, null, 2));
        toast({
          title: "Embed Generated",
          description: `${type === 'unmatched' ? 'Unmatched users' : `${group} template`} embed copied to clipboard.`,
        });
      } else {
        const error = await response.json();
        toast({
          title: "Generation Failed",
          description: error.error || "Failed to generate embed.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate embed.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingEmbed(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          Member Processing
        </CardTitle>
        <CardDescription>
          Process Discord members to identify Twitch links and generate shoutout embeds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-2">
          <Button
            onClick={handleProcessMembers}
            disabled={isProcessing}
            className="flex-1"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Users className="mr-2 h-4 w-4" />
                Process Members
              </>
            )}
          </Button>
        </div>

        {processedData && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>Processing Complete</AlertTitle>
            <AlertDescription>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <p className="font-medium">Total Members: {processedData.totalMembers}</p>
                  <p className="text-sm text-muted-foreground">
                    Linked: {processedData.linkedMembers} | Unmatched: {processedData.unmatchedMembers}
                  </p>
                </div>
                <div>
                  <p className="font-medium">Group Distribution:</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge variant="secondary">VIP: {processedData.groupCounts.VIP}</Badge>
                    <Badge variant="secondary">Raid Pile: {processedData.groupCounts['Raid Pile']}</Badge>
                    <Badge variant="secondary">Everyone Else: {processedData.groupCounts['Everyone Else']}</Badge>
                  </div>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <h4 className="font-medium">Generate Embeds</h4>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => handleGenerateEmbed('unmatched')}
              disabled={isGeneratingEmbed === 'unmatched'}
              className="justify-start"
            >
              {isGeneratingEmbed === 'unmatched' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Link className="mr-2 h-4 w-4" />
              )}
              Unmatched Users
            </Button>
            <Button
              variant="outline"
              onClick={() => handleGenerateEmbed('vip')}
              disabled={isGeneratingEmbed === 'vip'}
              className="justify-start"
            >
              {isGeneratingEmbed === 'vip' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="mr-2 h-4 w-4" />
              )}
              VIP Template
            </Button>
            <Button
              variant="outline"
              onClick={() => handleGenerateEmbed('raid-pile')}
              disabled={isGeneratingEmbed === 'raid-pile'}
              className="justify-start"
            >
              {isGeneratingEmbed === 'raid-pile' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="mr-2 h-4 w-4" />
              )}
              Raid Pile Template
            </Button>
            <Button
              variant="outline"
              onClick={() => handleGenerateEmbed('everyone-else')}
              disabled={isGeneratingEmbed === 'everyone-else'}
              className="justify-start"
            >
              {isGeneratingEmbed === 'everyone-else' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="mr-2 h-4 w-4" />
              )}
              Everyone Else Template
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
