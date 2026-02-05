'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Users, Link, CheckCircle } from 'lucide-react';
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
  const [isBatchLinking, setIsBatchLinking] = React.useState(false);
  const [processedData, setProcessedData] = React.useState<ProcessedMemberData | null>(null);


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

  const handleBatchLink = async () => {
    setIsBatchLinking(true);
    try {
      const response = await fetch('/api/discord/batch-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId })
      });

      if (response.ok) {
        const result = await response.json();
        toast({
          title: "Batch Linking Complete",
          description: `Linked: ${result.linked}, Not Found: ${result.notFound.length}`,
        });
        // Refresh the processed data
        handleProcessMembers();
      } else {
        const error = await response.json();
        toast({
          title: "Batch Linking Failed",
          description: error.error || "Failed to batch link.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to batch link accounts.",
        variant: "destructive",
      });
    } finally {
      setIsBatchLinking(false);
    }
  };

  const handleShowUnmatched = () => {
    if (!processedData) {
      toast({
        title: "Process Members First",
        description: "Click 'Process Members' to see unmatched users.",
        variant: "destructive",
      });
      return;
    }

    const userList = processedData.unmatchedUsers
      .map(u => `${u.displayName} (@${u.username})`)
      .join('\n');

    navigator.clipboard.writeText(userList);
    toast({
      title: "Unmatched Users Copied",
      description: `${processedData.unmatchedUsers.length} usernames copied to clipboard.`,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          Member Processing
        </CardTitle>
        <CardDescription>
          Process Discord members to identify Twitch links and post template embeds.
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
          <Button
            onClick={handleBatchLink}
            disabled={isBatchLinking}
            variant="secondary"
            className="flex-1"
          >
            {isBatchLinking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Linking...
              </>
            ) : (
              <>
                <Link className="mr-2 h-4 w-4" />
                Auto-Link Accounts
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

        <Button
          variant="outline"
          onClick={handleShowUnmatched}
          disabled={!processedData}
          className="justify-start w-full"
        >
          <Link className="mr-2 h-4 w-4" />
          Copy Unmatched Users List
        </Button>
      </CardContent>
    </Card>
  );
}
