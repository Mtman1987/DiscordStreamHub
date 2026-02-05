import { db } from '@/firebase/server-init';
import { PointsService } from './points-service';
import { getServerBranding } from './server-branding';

export interface RaidPileMember {
  userId: string;
  username: string;
  displayName: string;
  joinedAt: string;
  lastRaidedAt?: string;
  currentViewers?: number;
  isLive?: boolean;
  pileId: string;
}

export interface RaidPile {
  id: string;
  holderId: string;
  holderUsername: string;
  holderDisplayName: string;
  members: RaidPileMember[];
  createdAt: string;
  lastUpdated: string;
}

export class RaidPileService {
  private static instance: RaidPileService;
  
  static getInstance(): RaidPileService {
    if (!RaidPileService.instance) {
      RaidPileService.instance = new RaidPileService();
    }
    return RaidPileService.instance;
  }

  async joinPile(userId: string, username: string, displayName: string): Promise<{ success: boolean; pileId: string }> {
    const availablePile = await this.findAvailablePile();
    const member: RaidPileMember = {
      userId,
      username,
      displayName,
      joinedAt: new Date().toISOString(),
      pileId: availablePile.id
    };

    availablePile.members.push(member);
    availablePile.lastUpdated = new Date().toISOString();

    await setDoc(doc(db, 'raidPiles', availablePile.id), availablePile);
    await this.checkForSplit();

    return { success: true, pileId: availablePile.id };
  }

  async leavePile(userId: string): Promise<boolean> {
    const piles = await this.getAllPiles();
    
    for (const pile of piles) {
      const memberIndex = pile.members.findIndex(m => m.userId === userId);
      if (memberIndex !== -1) {
        pile.members.splice(memberIndex, 1);
        pile.lastUpdated = new Date().toISOString();
        
        await setDoc(doc(db, 'raidPiles', pile.id), pile);
        await this.checkForMerge();
        return true;
      }
    }
    return false;
  }

  async getNextRaidTarget(currentUserId: string): Promise<{ target: RaidPileMember | null; message: string }> {
    const piles = await this.getAllPiles();
    const allMembers: RaidPileMember[] = [];
    
    piles.forEach(pile => {
      allMembers.push(...pile.members.filter(m => m.userId !== currentUserId));
    });

    if (allMembers.length === 0) {
      return { target: null, message: "No one else is in the raid pile!" };
    }

    // 60/40 split: 60% weight on fewest viewers, 40% on longest wait
    const scoredMembers = allMembers.map(member => {
      const viewerScore = this.calculateViewerScore(member.currentViewers || 0);
      const waitScore = this.calculateWaitScore(member.lastRaidedAt);
      const totalScore = (viewerScore * 0.6) + (waitScore * 0.4);
      
      return { member, score: totalScore };
    });

    scoredMembers.sort((a, b) => b.score - a.score);
    const target = scoredMembers[0].member;

    // Update last raided time
    await this.updateMemberRaidTime(target.userId);

    return {
      target,
      message: `🎯 Next raid target: ${target.displayName} (@${target.username}) - ${target.currentViewers || 0} viewers`
    };
  }

  private calculateViewerScore(viewers: number): number {
    // Higher score for fewer viewers (inverse relationship)
    const maxViewers = 1000;
    return Math.max(0, (maxViewers - viewers) / maxViewers);
  }

  private calculateWaitScore(lastRaidedAt?: string): number {
    if (!lastRaidedAt) return 1; // Never been raided = highest score
    
    const lastRaid = new Date(lastRaidedAt);
    const now = new Date();
    const hoursSinceRaid = (now.getTime() - lastRaid.getTime()) / (1000 * 60 * 60);
    
    // Higher score for longer wait (max 168 hours = 1 week)
    return Math.min(1, hoursSinceRaid / 168);
  }

  private async updateMemberRaidTime(userId: string): Promise<void> {
    const piles = await this.getAllPiles();
    
    for (const pile of piles) {
      const member = pile.members.find(m => m.userId === userId);
      if (member) {
        member.lastRaidedAt = new Date().toISOString();
        await setDoc(doc(db, 'raidPiles', pile.id), pile);
        break;
      }
    }
  }

  async updateMemberViewers(userId: string, viewers: number, isLive: boolean): Promise<void> {
    const piles = await this.getAllPiles();
    
    for (const pile of piles) {
      const member = pile.members.find(m => m.userId === userId);
      if (member) {
        member.currentViewers = viewers;
        member.isLive = isLive;
        await setDoc(doc(db, 'raidPiles', pile.id), pile);
        break;
      }
    }
  }

  async awardRaidPoints(userId: string, username: string, displayName: string): Promise<void> {
    const points = parseInt(process.env.RAID_PILE_POINTS_REWARD || '25');
    const pointsService = PointsService.getInstance();
    await pointsService.addPoints(userId, username, displayName, points);
  }

  private async findAvailablePile(): Promise<RaidPile> {
    const piles = await this.getAllPiles();
    const maxSize = parseInt(process.env.RAID_PILE_MAX_SIZE || '40');
    
    // Find pile with space
    for (const pile of piles) {
      if (pile.members.length < maxSize) {
        return pile;
      }
    }
    
    // Create new pile if all are full
    return await this.createNewPile();
  }

  private async createNewPile(): Promise<RaidPile> {
    const pileId = `pile_${Date.now()}`;
    const pile: RaidPile = {
      id: pileId,
      holderId: '', // Will be assigned when first member joins
      holderUsername: '',
      holderDisplayName: '',
      members: [],
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
    
    await setDoc(doc(db, 'raidPiles', pileId), pile);
    return pile;
  }

  private async checkForSplit(): Promise<void> {
    const piles = await this.getAllPiles();
    const maxSize = parseInt(process.env.RAID_PILE_MAX_SIZE || '40');
    
    for (const pile of piles) {
      if (pile.members.length > maxSize) {
        await this.splitPile(pile);
      }
    }
  }

  private async splitPile(pile: RaidPile): Promise<void> {
    const halfSize = Math.floor(pile.members.length / 2);
    const firstHalf = pile.members.slice(0, halfSize);
    const secondHalf = pile.members.slice(halfSize);
    
    // Update original pile
    pile.members = firstHalf;
    pile.lastUpdated = new Date().toISOString();
    await setDoc(doc(db, 'raidPiles', pile.id), pile);
    
    // Create new pile for second half
    const newPileId = `pile_${Date.now()}`;
    const newPile: RaidPile = {
      id: newPileId,
      holderId: secondHalf[0]?.userId || '',
      holderUsername: secondHalf[0]?.username || '',
      holderDisplayName: secondHalf[0]?.displayName || '',
      members: secondHalf.map(m => ({ ...m, pileId: newPileId })),
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
    
    await setDoc(doc(db, 'raidPiles', newPileId), newPile);
  }

  private async checkForMerge(): Promise<void> {
    const piles = await this.getAllPiles();
    const minSize = parseInt(process.env.RAID_PILE_MIN_SIZE || '10');
    
    const smallPiles = piles.filter(pile => pile.members.length < minSize);
    
    if (smallPiles.length >= 2) {
      await this.mergePiles(smallPiles);
    }
  }

  private async mergePiles(piles: RaidPile[]): Promise<void> {
    if (piles.length < 2) return;
    
    const mainPile = piles[0];
    const otherPiles = piles.slice(1);
    
    // Merge all members into main pile
    otherPiles.forEach(pile => {
      mainPile.members.push(...pile.members.map(m => ({ ...m, pileId: mainPile.id })));
    });
    
    mainPile.lastUpdated = new Date().toISOString();
    await setDoc(doc(db, 'raidPiles', mainPile.id), mainPile);
    
    // Delete other piles
    for (const pile of otherPiles) {
      await deleteDoc(doc(db, 'raidPiles', pile.id));
    }
  }

  async getAllPiles(): Promise<RaidPile[]> {
    const q = query(collection(db, 'raidPiles'), orderBy('createdAt'));
    const querySnapshot = await getDocs(q);
    
    const piles: RaidPile[] = [];
    querySnapshot.forEach(doc => {
      piles.push(doc.data() as RaidPile);
    });
    
    return piles;
  }

  async getPileForUser(userId: string): Promise<RaidPile | null> {
    const piles = await this.getAllPiles();
    return piles.find(pile => pile.members.some(m => m.userId === userId)) || null;
  }

  async generateDiscordEmbed(piles: RaidPile[], serverId: string): Promise<any> {
    const branding = await getServerBranding(serverId);
    const fields = piles.map((pile, index) => {
      const memberList = pile.members.slice(0, 10).map(member => {
        const status = member.isLive ? '🔴' : '⚫';
        const viewers = member.currentViewers ? ` (${member.currentViewers})` : '';
        return `${status} ${member.displayName}${viewers}`;
      }).join('\n');
      
      const moreMembers = pile.members.length > 10 ? `\n... and ${pile.members.length - 10} more` : '';
      
      return {
        name: `🏔️ Pile ${index + 1} (${pile.members.length} members)`,
        value: memberList + moreMembers || 'No members yet',
        inline: true
      };
    });

    const totalMembers = piles.reduce((sum, pile) => sum + pile.members.length, 0);

    return {
      embeds: [{
        timestamp: new Date().toISOString(),
        title: `🏔️ ${branding.serverName} Raid Pile`,
        description: `Free to join! Everyone gets shoutouts, and raid holders get special treatment.\n\n**Total Members:** ${totalMembers}`,
        color: 0x9146FF,
        fields,
        footer: {
          text: 'Use the buttons below to join or leave the pile'
        }
      }],
      components: [{
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            label: 'Join Pile',
            custom_id: 'raid_pile_join',
            emoji: { name: '🏔️' }
          },
          {
            type: 2,
            style: 4,
            label: 'Leave Pile',
            custom_id: 'raid_pile_leave',
            emoji: { name: '❌' }
          },
          {
            type: 2,
            style: 2,
            label: 'Next Target',
            custom_id: 'raid_pile_next',
            emoji: { name: '🎯' }
          }
        ]
      }]
    };
  }
}