import { NextRequest, NextResponse } from 'next/server';
import { db, storage } from '@/firebase/server-init';
import { getUserByLogin, getClipsForUser } from '@/lib/twitch-api-service';
import { convertClipToGif } from '@/lib/gif-conversion-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();
    if (!serverId) {
      return NextResponse.json({ error: 'serverId required' }, { status: 400 });
    }

    console.log('[Cleanup] Starting cleanup and refill...');
    
    const usersSnapshot = await db.collection('servers').doc(serverId).collection('users').get();
    const vipUsers = usersSnapshot.docs
      .map(doc => ({
        discordUserId: doc.id,
        twitchLogin: doc.data().twitchLogin,
        group: doc.data().group
      }))
      .filter(u => u.twitchLogin && (u.group === 'Crew' || u.group === 'Partners' || u.group === 'Vip'));

    console.log(`[Cleanup] Found ${vipUsers.length} VIP users`);

    for (const user of vipUsers) {
      console.log(`[Cleanup] Processing ${user.twitchLogin}...`);
      
      // Get all clips for this user
      const clipsSnapshot = await db.collection('servers').doc(serverId)
        .collection('users').doc(user.discordUserId)
        .collection('clips')
        .get();

      // Delete Star Wars fallback clips
      let deletedCount = 0;
      for (const clipDoc of clipsSnapshot.docs) {
        const clipData = clipDoc.data();
        if (clipData.gifUrl.includes('tenor.com')) {
          await clipDoc.ref.delete();
          deletedCount++;
        }
      }

      console.log(`[Cleanup] Deleted ${deletedCount} fallback clips for ${user.twitchLogin}`);

      // Count remaining real clips
      const remainingSnapshot = await db.collection('servers').doc(serverId)
        .collection('users').doc(user.discordUserId)
        .collection('clips')
        .get();
      
      const needed = 10 - remainingSnapshot.size;
      if (needed <= 0) {
        console.log(`[Cleanup] ${user.twitchLogin} already has ${remainingSnapshot.size} clips`);
        continue;
      }

      console.log(`[Cleanup] ${user.twitchLogin} needs ${needed} more clips`);

      // Fetch more clips
      const twitchUser = await getUserByLogin(user.twitchLogin);
      if (!twitchUser) continue;

      const clips = await getClipsForUser(twitchUser.id, 50);
      const existingIds = new Set(remainingSnapshot.docs.map(d => d.id));

      let successCount = 0;
      for (const clip of clips) {
        if (successCount >= needed) break;
        if (existingIds.has(clip.id)) continue;

        const mp4Url = clip.thumbnail_url.split('-preview-')[0] + '.mp4';
        const gifUrl = await convertClipToGif(
          mp4Url,
          clip.id,
          user.twitchLogin,
          Math.min(clip.duration, 60),
          'stream',
          { serverId }
        );

        if (gifUrl && !gifUrl.includes('tenor.com')) {
          await db.collection('servers').doc(serverId)
            .collection('users').doc(user.discordUserId)
            .collection('clips').doc(clip.id)
            .set({
              clipId: clip.id,
              gifUrl,
              twitchLogin: user.twitchLogin,
              title: clip.title,
              createdAt: clip.created_at,
              cachedAt: new Date().toISOString()
            });
          successCount++;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`[Cleanup] Added ${successCount} clips for ${user.twitchLogin}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('[Cleanup] Complete!');
    return NextResponse.json({ success: true, message: 'Cleanup complete' });
  } catch (error) {
    console.error('[Cleanup] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
