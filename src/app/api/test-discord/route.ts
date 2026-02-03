export async function GET() {
  const serverId = '1240832965865635881'; // Your guild ID
  
  try {
    const token = process.env.DISCORD_BOT_TOKEN;
    
    if (!token) {
      return Response.json({ error: 'No Discord token found in environment variables' }, { status: 500 });
    }

    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { 'Authorization': `Bot ${token}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      return Response.json({ success: true, botUser: data.username, serverId });
    } else {
      return Response.json({ 
        error: 'Token invalid', 
        status: response.status,
        tokenLength: token.length 
      }, { status: 401 });
    }
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
