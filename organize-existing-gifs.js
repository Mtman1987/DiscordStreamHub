require('dotenv').config();
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const fs = require('fs');

// Initialize Firebase Admin
const serviceAccount = JSON.parse(fs.readFileSync('./studio-9468926194-e03ac-firebase-adminsdk-fbsvc-75298e056b.json', 'utf8'));
const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: 'studio-9468926194-e03ac',
  storageBucket: 'studio-9468926194-e03ac.firebasestorage.app'
});

const db = getFirestore(app);
const storage = getStorage(app);

// Parse filename patterns
function parseGifFilename(filename) {
  // Pattern: username_contenttype_username_timestamp1_timestamp2.gif
  // Examples: 
  // - armybigworm09_shoutout_armybigworm09_1762960727686_1762960839872.gif
  // - footer_footer_1763044864461_1763044883889.gif
  
  const match = filename.match(/^(.+?)_(shoutout|footer|header)_(.+?)_(\d+)_(\d+)\.gif$/i);
  if (!match) return null;
  
  const [, username1, contentType, username2, timestamp1, timestamp2] = match;
  
  // Use the cleaner username (sometimes they differ in case)
  const username = username1.toLowerCase();
  
  return {
    username,
    contentType: contentType.toLowerCase(),
    mediaType: 'gif',
    timestamp: parseInt(timestamp2), // Use end timestamp
    originalFilename: filename
  };
}

async function organizeExistingGifs() {
  console.log('🔍 Scanning Firebase Storage for existing GIFs...');
  
  try {
    const bucket = storage.bucket();
    const [files] = await bucket.getFiles({ prefix: '' });
    
    const gifFiles = files.filter(file => file.name.endsWith('.gif'));
    console.log(`Found ${gifFiles.length} GIF files`);
    
    const organized = {};
    const failed = [];
    
    for (const file of gifFiles) {
      const filename = file.name.split('/').pop(); // Get just the filename
      const parsed = parseGifFilename(filename);
      
      if (!parsed) {
        failed.push(filename);
        continue;
      }
      
      const { username, contentType, mediaType } = parsed;
      const key = `${username}_${contentType}_${mediaType}`;
      
      if (!organized[key]) {
        organized[key] = [];
      }
      
      organized[key].push({
        ...parsed,
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        storagePath: file.name,
        size: file.metadata?.size || 0
      });
    }
    
    console.log(`\n📊 Organization Results:`);
    console.log(`✅ Successfully parsed: ${Object.keys(organized).length} unique user/content combinations`);
    console.log(`❌ Failed to parse: ${failed.length} files`);
    
    if (failed.length > 0) {
      console.log('\n🚫 Failed files:');
      failed.forEach(f => console.log(`  - ${f}`));
    }
    
    // Save to Firestore
    console.log('\n💾 Saving to Firestore media fallback system...');
    
    const serverId = process.env.HARDCODED_GUILD_ID || '1240832965865635881';
    let savedCount = 0;
    
    for (const [key, gifs] of Object.entries(organized)) {
      const [username, contentType, mediaType] = key.split('_');
      
      // Sort by timestamp (newest first) and take the best quality ones
      const sortedGifs = gifs.sort((a, b) => b.timestamp - a.timestamp);
      
      // Keep up to 3 GIFs per user/content type, prefer smaller file sizes for better performance
      const bestGifs = sortedGifs
        .filter(gif => gif.size < 50 * 1024 * 1024) // Under 50MB
        .slice(0, 3)
        .map(gif => ({
          url: gif.url,
          timestamp: gif.timestamp,
          size: gif.size,
          originalFilename: gif.originalFilename
        }));
      
      if (bestGifs.length === 0) {
        // If all are too big, take the smallest one
        const smallest = sortedGifs.reduce((min, gif) => gif.size < min.size ? gif : min);
        bestGifs.push({
          url: smallest.url,
          timestamp: smallest.timestamp,
          size: smallest.size,
          originalFilename: smallest.originalFilename
        });
      }
      
      const docPath = `servers/${serverId}/mediaFallback/${username}_${contentType}_${mediaType}`;
      
      await db.doc(docPath).set({
        username,
        mediaType,
        contentType: contentType === 'shoutout' ? 'spotlight' : contentType,
        gifs: bestGifs,
        totalCount: gifs.length,
        lastUpdated: new Date(),
        source: 'organized_existing'
      });
      
      savedCount++;
      console.log(`  ✅ ${username} (${contentType}): ${bestGifs.length} GIFs saved`);
    }
    
    console.log(`\n🎉 Successfully organized ${savedCount} media entries!`);
    
    // Summary by user
    console.log('\n👥 Summary by user:');
    const userSummary = {};
    Object.keys(organized).forEach(key => {
      const [username] = key.split('_');
      if (!userSummary[username]) userSummary[username] = 0;
      userSummary[username]++;
    });
    
    Object.entries(userSummary)
      .sort(([,a], [,b]) => b - a)
      .forEach(([username, count]) => {
        console.log(`  ${username}: ${count} content types`);
      });
    
  } catch (error) {
    console.error('❌ Error organizing GIFs:', error);
  }
}

// Run the organization
if (require.main === module) {
  organizeExistingGifs().then(() => {
    console.log('\n✨ Organization complete!');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { organizeExistingGifs, parseGifFilename };