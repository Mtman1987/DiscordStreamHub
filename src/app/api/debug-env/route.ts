export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const allEnvKeys = Object.keys(process.env).sort();
  const discordKeys = allEnvKeys.filter(key => key.includes('DISCORD'));
  
  return Response.json({
    hasDiscordToken: !!process.env.DISCORD_BOT_TOKEN,
    tokenLength: process.env.DISCORD_BOT_TOKEN?.length || 0,
    tokenPreview: process.env.DISCORD_BOT_TOKEN ? process.env.DISCORD_BOT_TOKEN.substring(0, 10) + '...' : 'NOT_FOUND',
    nodeEnv: process.env.NODE_ENV,
    totalEnvVars: allEnvKeys.length,
    discordKeys,
    dataDir: process.env.DATA_DIR || process.env.FLY_VOLUME_PATH || '/data',
    databaseFile: process.env.DB_FILE || '/data/app.db',
    storagePath: process.env.STORAGE_PATH || '/data/clips'
  });
}
