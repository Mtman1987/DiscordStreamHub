import { db } from '@/firebase/server-init';
import { addDays, format, startOfDay, addHours } from 'date-fns';
import { getServerBranding } from './server-branding';

interface RaidTrainSlot {
  id: string;
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  userId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  twitchUsername?: string;
  signupTime?: Date;
  points?: number;
}

class RaidTrainService {
  async getScheduleForDate(serverId: string, date: Date): Promise<RaidTrainSlot[]> {
    const dateStr = format(date, 'yyyy-MM-dd');
    const snapshot = await db
      .collection('servers')
      .doc(serverId)
      .collection('raidTrainSlots')
      .where('date', '==', dateStr)
      .get();

    const slots: RaidTrainSlot[] = [];
    
    // Create all 24 hour slots
    for (let hour = 0; hour < 24; hour++) {
      const slotId = `${dateStr}-${hour.toString().padStart(2, '0')}`;
      const existingSlot = snapshot.docs.find(doc => doc.data().hour === hour);
      
      slots.push({
        id: slotId,
        date: dateStr,
        hour,
        userId: existingSlot?.data().userId,
        username: existingSlot?.data().username,
        displayName: existingSlot?.data().displayName,
        avatarUrl: existingSlot?.data().avatarUrl,
        twitchUsername: existingSlot?.data().twitchUsername,
        signupTime: existingSlot?.data().signupTime?.toDate(),
        points: existingSlot?.data().points || 0,
      });
    }

    return slots;
  }

  async signupForSlot(serverId: string, date: string, hour: number, userInfo: {
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    twitchUsername?: string;
  }): Promise<boolean> {
    const slotId = `${date}-${hour.toString().padStart(2, '0')}`;
    const slotRef = db
      .collection('servers')
      .doc(serverId)
      .collection('raidTrainSlots')
      .doc(slotId);

    // Check if slot is already taken
    const existingSlot = await slotRef.get();
    if (existingSlot.exists && existingSlot.data()?.userId) {
      return false; // Slot already taken
    }

    // Check if it's the same day (prevent day-of signups)
    const slotDate = new Date(date);
    const today = startOfDay(new Date());
    if (slotDate.getTime() === today.getTime()) {
      return false; // Cannot signup for today
    }

    await slotRef.set({
      date,
      hour,
      userId: userInfo.userId,
      username: userInfo.username,
      displayName: userInfo.displayName,
      avatarUrl: userInfo.avatarUrl,
      twitchUsername: userInfo.twitchUsername,
      signupTime: new Date(),
      points: 0,
    });

    return true;
  }

  async cancelSlot(serverId: string, date: string, hour: number, userId: string): Promise<boolean> {
    const slotId = `${date}-${hour.toString().padStart(2, '0')}`;
    const slotRef = db
      .collection('servers')
      .doc(serverId)
      .collection('raidTrainSlots')
      .doc(slotId);

    const slot = await slotRef.get();
    if (!slot.exists || slot.data()?.userId !== userId) {
      return false; // Not your slot
    }

    await slotRef.delete();
    return true;
  }

  async generateScheduleEmbed(slots: RaidTrainSlot[], date: Date, serverId: string): Promise<any> {
    const branding = await getServerBranding(serverId);
    const dateStr = format(date, 'EEEE, MMMM do');
    const filledSlots = slots.filter(slot => slot.userId);
    const availableSlots = slots.filter(slot => !slot.userId);

    const fields = [];

    // Show filled slots
    if (filledSlots.length > 0) {
      const filledText = filledSlots
        .map(slot => `${slot.hour.toString().padStart(2, '0')}:00 - ${slot.displayName}`)
        .join('\n');
      
      fields.push({
        name: '🚂 Claimed Slots',
        value: filledText.length > 1024 ? filledText.substring(0, 1021) + '...' : filledText,
        inline: true,
      });
    }

    // Show available slots (first 10)
    if (availableSlots.length > 0) {
      const availableText = availableSlots
        .slice(0, 10)
        .map(slot => `${slot.hour.toString().padStart(2, '0')}:00`)
        .join(', ');
      
      fields.push({
        name: '⏰ Available Slots',
        value: availableText + (availableSlots.length > 10 ? ` +${availableSlots.length - 10} more` : ''),
        inline: true,
      });
    }

    return {
      title: `🚂 ${branding.serverName} Raid Train - ${dateStr}`,
      description: `All aboard the cosmic express! Sign up for your time slot to lead the raid train through the galaxy.`,
      color: 0xff4500,
      fields,
      footer: {
        text: `${filledSlots.length}/24 slots filled | Cannot signup for today`,
      },
      timestamp: new Date().toISOString(),
    };
  }

  generateScheduleButtons(date: Date): any[] {
    const dateStr = format(date, 'yyyy-MM-dd');
    const tomorrow = addDays(new Date(), 1);
    const dayAfter = addDays(new Date(), 2);

    return [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            label: 'Sign Up',
            custom_id: `raid_signup_${dateStr}`,
          },
          {
            type: 2,
            style: 2,
            label: 'View Schedule',
            custom_id: `raid_view_${dateStr}`,
          },
          {
            type: 2,
            style: 4,
            label: 'Cancel Slot',
            custom_id: `raid_cancel_${dateStr}`,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: format(tomorrow, 'MMM d'),
            custom_id: `raid_day_${format(tomorrow, 'yyyy-MM-dd')}`,
          },
          {
            type: 2,
            style: 2,
            label: format(dayAfter, 'MMM d'),
            custom_id: `raid_day_${format(dayAfter, 'yyyy-MM-dd')}`,
          },
        ],
      },
    ];
  }
}

export const raidTrainService = new RaidTrainService();
export { RaidTrainService };
