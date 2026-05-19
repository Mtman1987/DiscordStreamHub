export async function GET() {
  const allEnvKeys = Object.keys(process.env).sort();
  const discordKeys = allEnvKeys.filter(key => key.includes('DISCORD'));
  
  return Response.json({
    hasDiscordToken: !!process.env.DISCORD_BOT_TOKEN,
    tokenLength: process.env.DISCORD_BOT_TOKEN?.length || 0,
    tokenPreview: process.env.DISCORD_BOT_TOKEN ? process.env.DISCORD_BOT_TOKEN.substring(0, 10) + '...' : 'NOT_FOUND',
    nodeEnv: process.env.NODE_ENV,
    totalEnvVars: allEnvKeys.length,
    discordKeys,
    hasFirebaseConfig: !!process.env.FIREBASE_CONFIG,
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
  });
}
