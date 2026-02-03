'use server';

import { db, storage } from '@/firebase/server-init';
import { getUserByLogin, getClipsForUser } from './twitch-api-service';
import { getClipVideoUrl } from './clip-url-finder';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ClipMp4 {
  clipId: string;
  mp4Url: string;
  twitchLogin: string;
  title: string;
  createdAt: string;
  duration: number;
}

// Step 1: Download MP4s for all users (fast)
export async function seedMp4s(serverId: string): Promise<void> {
  console.log('[Seeding] Step 1: Downloading MP4s for all Crew/Partners/VIP');
  
  const users = await getCrewAndPartners(serverId);
  console.log(`[Seeding] Found ${users.length} users`);
  
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    try {
      console.log(`[Seeding] ${i + 1}/${users.length}: ${user.twitchLogin}`);
      
      const twitchUser = await getUserByLogin(user.twitchLogin);
      if (!twitchUser) continue;

      const clips = await getClipsForUser(twitchUser.id, 50);
      console.log(`[Seeding] Found ${clips.length} clips`);
      
      let successCount = 0;
      let clipIndex = 0;
      
      while (successCount < 10 && clipIndex < clips.length) {
        const clip = clips[clipIndex];
        clipIndex++;
        
        try {
          const mp4Url = await getClipVideoUrl(clip.url);
          if (!mp4Url) {
            console.log(`[Seeding] ⚠️ No URL for clip ${clip.id}, trying next...`);
            continue;
          }
          
          const tempMp4 = join(tmpdir(), `${clip.id}.mp4`);
          const mp4Response = await fetch(mp4Url);
          if (!mp4Response.ok) {
            console.log(`[Seeding] ⚠️ Download failed for ${clip.id}, trying next...`);
            continue;
          }
          
          const mp4Buffer = Buffer.from(await mp4Response.arrayBuffer());
          if (mp4Buffer.length === 0) {
            console.log(`[Seeding] ⚠️ Empty file for ${clip.id}, trying next...`);
            continue;
          }
          
          await writeFile(tempMp4, mp4Buffer);
          
          // Upload to Firebase
          const mp4StoragePath = `clips/${user.twitchLogin}/${clip.id}.mp4`;
          const bucket = storage.bucket();
          await bucket.upload(tempMp4, {
            destination: mp4StoragePath,
            metadata: { contentType: 'video/mp4' }
          });
          
          const mp4File = bucket.file(mp4StoragePath);
          await mp4File.makePublic();
          const storedMp4Url = `https://storage.googleapis.com/${bucket.name}/${mp4StoragePath}`;
          
          // Save MP4 reference
          await db.collection('servers').doc(serverId)
            .collection('users').doc(user.discordUserId)
            .collection('clipMp4s').doc(clip.id)
            .set({
              clipId: clip.id,
              mp4Url: storedMp4Url,
              twitchLogin: user.twitchLogin,
              title: clip.title,
              createdAt: clip.created_at,
              duration: clip.duration
            });
          
          await unlink(tempMp4).catch(() => {});
          successCount++;
          console.log(`[Seeding] ✅ ${user.twitchLogin}: ${successCount}/10`);
        } catch (error) {
          console.error(`[Seeding] ⚠️ Error on clip ${clip.id}, trying next:`, error);
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`[Seeding] Error for ${user.twitchLogin}:`, error);
    }
  }
  
  console.log('[Seeding] 🎉 MP4 download complete!');
}

// Step 2: Convert MP4s to GIFs (slow, can run in background)
export async function convertMp4sToGifs(serverId: string, concurrency: number = 2): Promise<void> {
  console.log(`[Seeding] Step 2: Converting MP4s to GIFs (${concurrency} at a time)`);
  
  const users = await getCrewAndPartners(serverId);
  
  for (const user of users) {
    try {
      const mp4Snapshot = await db.collection('servers').doc(serverId)
        .collection('users').doc(user.discordUserId)
        .collection('clipMp4s')
        .get();
      
      if (mp4Snapshot.empty) continue;
      
      console.log(`[Seeding] Converting ${mp4Snapshot.size} clips for ${user.twitchLogin}`);
      
      const mp4s = mp4Snapshot.docs.map(d => d.data() as ClipMp4);
      
      // Process in batches
      for (let i = 0; i < mp4s.length; i += concurrency) {
        const batch = mp4s.slice(i, i + concurrency);
        await Promise.all(batch.map(mp4 => convertSingleMp4ToGif(serverId, user.discordUserId, mp4)));
      }
      
      console.log(`[Seeding] ✅ Completed ${user.twitchLogin}`);
    } catch (error) {
      console.error(`[Seeding] Error converting for ${user.twitchLogin}:`, error);
    }
  }
  
  console.log('[Seeding] 🎉 GIF conversion complete!');
}

async function convertSingleMp4ToGif(serverId: string, userId: string, mp4: ClipMp4): Promise<void> {
  const tempMp4 = join(tmpdir(), `${mp4.clipId}_convert.mp4`);
  const tempGif = join(tmpdir(), `${mp4.clipId}.gif`);
  const palettePath = join(tmpdir(), `${mp4.clipId}_palette.png`);
  
  try {
    // Download MP4 from Firebase
    const mp4Response = await fetch(mp4.mp4Url);
    const mp4Buffer = Buffer.from(await mp4Response.arrayBuffer());
    await writeFile(tempMp4, mp4Buffer);
    
    // Convert to GIF
    const fps = 15;
    const maxDuration = Math.min(mp4.duration, 60);
    
    await execAsync(`ffmpeg -y -i "${tempMp4}" -vf "fps=${fps},scale=400:-1:flags=lanczos,palettegen" "${palettePath}"`);
    await execAsync(`ffmpeg -y -t ${maxDuration} -i "${tempMp4}" -i "${palettePath}" -filter_complex "fps=${fps},scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse" "${tempGif}"`);
    
    // Upload GIF
    const gifStoragePath = `clips/${mp4.twitchLogin}/${Date.now()}.gif`;
    const bucket = storage.bucket();
    await bucket.upload(tempGif, {
      destination: gifStoragePath,
      metadata: { contentType: 'image/gif' }
    });
    
    const gifFile = bucket.file(gifStoragePath);
    await gifFile.makePublic();
    const gifUrl = `https://storage.googleapis.com/${bucket.name}/${gifStoragePath}`;
    
    // Save to clips collection
    await db.collection('servers').doc(serverId)
      .collection('users').doc(userId)
      .collection('clips').doc(mp4.clipId)
      .set({
        clipId: mp4.clipId,
        gifUrl,
        twitchLogin: mp4.twitchLogin,
        title: mp4.title,
        createdAt: mp4.createdAt,
        cachedAt: new Date().toISOString()
      });
    
    console.log(`[Seeding] ✅ Converted ${mp4.twitchLogin}/${mp4.clipId}`);
  } catch (error) {
    console.error(`[Seeding] Error converting ${mp4.clipId}:`, error);
  } finally {
    await unlink(tempMp4).catch(() => {});
    await unlink(tempGif).catch(() => {});
    await unlink(palettePath).catch(() => {});
  }
}

async function getCrewAndPartners(serverId: string) {
  const snapshot = await db.collection('servers').doc(serverId)
    .collection('users')
    .get();

  return snapshot.docs
    .map(doc => ({
      discordUserId: doc.id,
      twitchLogin: doc.data().twitchLogin,
      group: doc.data().group
    }))
    .filter(u => u.twitchLogin && (u.group === 'Crew' || u.group === 'Partners' || u.group === 'Vip'));
}
