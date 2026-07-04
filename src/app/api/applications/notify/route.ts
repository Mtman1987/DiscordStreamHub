import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

function appendTemplateAttachment(embed: any, attachmentUrl?: string) {
  const url = String(attachmentUrl || '').trim();
  if (!url) return embed;

  if (/\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(url)) {
    embed.image = { url };
  } else {
    embed.fields = [
      ...(embed.fields || []),
      {
        name: 'Additional Information',
        value: `[Open attachment or resource](${url})`,
        inline: false,
      },
    ];
  }

  return embed;
}

export async function POST(req: NextRequest) {
  try {
    const { serverId, userId, type, status } = await req.json();

    if (!serverId || !userId || !type || !status) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 });
    }

    // Get server branding
    const serverDoc = await db.collection('servers').doc(serverId).get();
    const brandingDoc = await db.collection('servers').doc(serverId).collection('config').doc('branding').get();
    const serverName = brandingDoc.data()?.serverName || serverDoc.data()?.serverName || 'Space Mountain';

    // Get custom DM templates
    const templatesDoc = await db.collection('servers').doc(serverId).collection('config').doc('dmTemplates').get();
    const customTemplates = templatesDoc.data() || {};

    // Create DM channel with user
    const dmResponse = await fetch(`https://discord.com/api/v10/users/@me/channels`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_id: userId }),
    });

    if (!dmResponse.ok) {
      console.error('Failed to create DM channel');
      return NextResponse.json({ error: 'Failed to create DM' }, { status: 500 });
    }

    const dmChannel = await dmResponse.json();

    let embed;

    if (status === 'approved') {
      const customMsg = type === 'mod' ? customTemplates.modApproved : customTemplates.partnerApproved;
      const attachmentUrl = type === 'mod' ? customTemplates.modApprovedAttachmentUrl : customTemplates.partnerApprovedAttachmentUrl;
      if (type === 'mod') {
        embed = {
          title: '🎉 Mod Application Approved!',
          description: customMsg || `Congratulations! Your application to join the **${serverName}** Mod Team has been approved!`,
          color: 0x00FF00,
          fields: [
            {
              name: '📋 Next Steps',
              value: '1. You will receive your Mod role shortly\n2. Check the staff channels for onboarding info\n3. Review the mod guidelines and expectations\n4. Introduce yourself to the team!',
              inline: false
            },
            {
              name: '🛡️ Your Responsibilities',
              value: '• Monitor chat and enforce rules\n• Welcome new members\n• Help resolve conflicts\n• Stay active in staff channels',
              inline: false
            }
          ],
          footer: { text: `Welcome to the ${serverName} team!` },
          timestamp: new Date().toISOString()
        };
        appendTemplateAttachment(embed, attachmentUrl);
      } else {
        embed = {
          title: '🤝 Partnership Approved!',
          description: customMsg || `Congratulations! Your partnership application with **${serverName}** has been approved!`,
          color: 0x00FF00,
          fields: [
            {
              name: '📋 Welcome Package',
              value: '1. Set up your forum post in the partner section\n2. Your members get a "Free Ride" on our Raid Trains\n3. Grab your Partner role to access coordination channels\n4. Remind members about the 2-hour collision rule',
              inline: false
            },
            {
              name: '🚂 Raid Train Access',
              value: 'Your members can mention they\'re from ' + serverName + ' to get their first free ride on HSV or Monster Cave trains!',
              inline: false
            },
            {
              name: '⚠️ Important Rule',
              value: 'Members must leave a 2-hour gap between riding both trains on the same day.',
              inline: false
            }
          ],
          footer: { text: `Welcome to the ${serverName} family!` },
          timestamp: new Date().toISOString()
        };
        appendTemplateAttachment(embed, attachmentUrl);
      }
    } else {
      // Rejected
      const customMsg = type === 'mod' ? customTemplates.modRejected : customTemplates.partnerRejected;
      const attachmentUrl = type === 'mod' ? customTemplates.modRejectedAttachmentUrl : customTemplates.partnerRejectedAttachmentUrl;
      embed = {
        title: '💜 Application Update',
        description: customMsg || `Thank you for your interest in ${type === 'mod' ? 'joining the mod team' : 'partnering with us'} at **${serverName}**.`,
        color: 0x9146FF,
        fields: [
          {
            name: 'Application Status',
            value: `After careful review, we've decided not to move forward with your application at this time. This doesn't reflect on you personally - we had many great applicants!`,
            inline: false
          },
          {
            name: '💎 You\'re Still Valued!',
            value: type === 'mod' 
              ? `We'd love to see you stay active in the community! Keep engaging, helping others, and being awesome. You can always reapply in the future.`
              : `We appreciate your interest in partnering! Feel free to stay connected with our community and explore other collaboration opportunities.`,
            inline: false
          },
          {
            name: '🎁 Thank You Gift',
            value: 'As a thank you for applying, check out our community perks and feel free to participate in our events and raid trains!',
            inline: false
          }
        ],
        footer: { text: `Thank you for being part of ${serverName}` },
        timestamp: new Date().toISOString()
      };
      appendTemplateAttachment(embed, attachmentUrl);
    }

    // Send DM
    const messageResponse = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!messageResponse.ok) {
      console.error('Failed to send DM');
      return NextResponse.json({ error: 'Failed to send DM' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending notification:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
