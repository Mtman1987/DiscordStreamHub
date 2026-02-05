"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mountain, Users, Target, Crown, Eye, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RaidPileMember {
  userId: string;
  username: string;
  displayName: string;
  joinedAt: string;
  lastRaidedAt?: string;
  currentViewers?: number;
  isLive?: boolean;
  pileId: string;
}

interface RaidPile {
  id: string;
  holderId: string;
  holderUsername: string;
  holderDisplayName: string;
  members: RaidPileMember[];
  createdAt: string;
  lastUpdated: string;
}

export default function RaidPilePage() {
  const [piles, setPiles] = useState<RaidPile[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchPiles();
  }, []);

  const fetchPiles = async () => {
    try {
      const response = await fetch('/api/raid-pile/status', {
        headers: {
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_BOT_SECRET_KEY || '1234'}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setPiles(data);
      }
    } catch (error) {
      console.error('Error fetching piles:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateRaidPileChannel = async () => {
    try {
      const response = await fetch('/api/raid-pile/channel', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_BOT_SECRET_KEY || '1234'}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channelId: process.env.NEXT_PUBLIC_DISCORD_RAID_PILE_CHANNEL_ID
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        toast({
          title: "Raid Pile Updated!",
          description: `Posted ${result.totalMembers} members across ${result.totalPiles} piles to Discord.`,
        });
      } else {
        throw new Error('Failed to update channel');
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: "Could not update raid pile channel.",
      });
    }
  };

  const totalMembers = piles.reduce((sum, pile) => sum + pile.members.length, 0);
  const liveMembers = piles.reduce((sum, pile) => 
    sum + pile.members.filter(m => m.isLive).length, 0
  );

  if (loading) {
    return (
      <div className="grid gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">🏔️ Raid Pile</h1>
          <p className="text-muted-foreground">Loading pile status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            🏔️ Space Mountain Raid Pile
          </h1>
          <p className="text-muted-foreground">
            Free community raid system with intelligent targeting
          </p>
        </div>
        <Button onClick={updateRaidPileChannel}>
          🏔️ Update Channel
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-medium">Total Members</h3>
              <span className="text-base">👥</span>
            </div>
            <div className="text-2xl font-bold">{totalMembers}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-5">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-medium">Active Piles</h3>
              <span className="text-base">🏔️</span>
            </div>
            <div className="text-2xl font-bold">{piles.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-5">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-medium">Live Streamers</h3>
              <span className="text-base">👁️</span>
            </div>
            <div className="text-2xl font-bold">{liveMembers}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-5">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-medium">Points per Raid</h3>
              <span className="text-base">🎯</span>
            </div>
            <div className="text-2xl font-bold">{process.env.NEXT_PUBLIC_RAID_PILE_POINTS_REWARD || 25}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How Raid Pile Works</CardTitle>
          <CardDescription>Free community raid system with smart targeting</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-semibold mb-2">🏔️ Join the Pile</h4>
              <p>Anyone can join for free! Get shoutouts and be part of the community.</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">👑 Pile Holders</h4>
              <p>Special members get enhanced shoutouts with rotating clips like VIPs.</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">🎯 Smart Targeting</h4>
              <p>60% weight on lowest viewers, 40% on longest wait since last raid.</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">🔄 Auto Split/Merge</h4>
              <p>Piles split at {process.env.NEXT_PUBLIC_RAID_PILE_MAX_SIZE || 40}+ members, merge below {process.env.NEXT_PUBLIC_RAID_PILE_MIN_SIZE || 10}.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {piles.map((pile, index) => (
        <Card key={pile.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mountain className="h-5 w-5" />
              Pile {index + 1}
              <Badge variant="outline">{pile.members.length} members</Badge>
              {pile.holderId && (
                <Badge variant="default">
                  <Crown className="h-3 w-3 mr-1" />
                  Holder: {pile.holderDisplayName}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {pile.members.map((member) => (
                <div key={member.userId} className="flex items-center justify-between p-2 border rounded">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${member.isLive ? 'bg-red-500' : 'bg-gray-400'}`} />
                    <div>
                      <span className="font-medium">{member.displayName}</span>
                      <span className="text-sm text-muted-foreground ml-2">@{member.username}</span>
                      {member.userId === pile.holderId && (
                        <Crown className="h-4 w-4 inline ml-2 text-yellow-500" />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    {member.currentViewers !== undefined && (
                      <div className="flex items-center gap-1">
                        <Eye className="h-4 w-4" />
                        <span>{member.currentViewers}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>
                        {member.lastRaidedAt 
                          ? `${Math.floor((Date.now() - new Date(member.lastRaidedAt).getTime()) / (1000 * 60 * 60))}h ago`
                          : 'Never'
                        }
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {piles.length === 0 && (
        <Card>
          <CardContent className="text-center py-12">
            <Mountain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Active Piles</h3>
            <p className="text-muted-foreground">
              The raid pile is empty! Members can join through Discord or Twitch commands.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}