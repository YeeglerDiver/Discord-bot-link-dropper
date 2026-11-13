import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
  verifyKey,
} from 'discord-interactions';

// Add your links here and push to GitHub to update
const LINKS = [
  'https://example.com/link-1',
  'https://example.com/link-2',
  'https://example.com/link-3',
];

async function sendDirectMessage(userId, content, botToken) {
  // 1. Open (or fetch) a DM channel with the user
  const dmChannelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: userId }),
  });

  if (!dmChannelRes.ok) return false;
  const dmChannel = await dmChannelRes.json();

  // 2. Send the message into that DM channel
  const msgRes = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  return msgRes.ok;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    const body = await request.text();

    const isValidRequest =
      signature &&
      timestamp &&
      (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));

    if (!isValidRequest) {
      return new Response('Bad request signature', { status: 401 });
    }

    const interaction = JSON.parse(body);

    // 1. Discord URL verification ping
    if (interaction.type === InteractionType.PING) {
      return Response.json({ type: InteractionResponseType.PONG });
    }

    // 2. Handle /setup command to post the Embed + Button panel
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      if (interaction.data.name === 'setup') {
        return Response.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [
              {
                title: 'Link Dispenser',
                description: 'Click the button below to get a random link sent to your DMs.',
                color: 0x9b59b6, // Purple accent bar
              },
            ],
            components: [
              {
                type: 1, // Action Row
                components: [
                  {
                    type: 2, // Button
                    style: 3, // Green button (use 1 for Blurple, 2 for Grey)
                    label: 'Random Link',
                    custom_id: 'dispense_random_link',
                  },
                ],
              },
            ],
          },
        });
      }
    }

    // 3. Handle Button Click
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      if (interaction.data.custom_id === 'dispense_random_link') {
        const userId = interaction.member?.user?.id || interaction.user?.id;
        const randomLink = LINKS[Math.floor(Math.random() * LINKS.length)];

        // Send the DM asynchronously while responding to the click immediately
        ctx.waitUntil(
          sendDirectMessage(userId, `Here is your link: ${randomLink}`, env.DISCORD_TOKEN)
        );

        return Response.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Check your DMs! (Make sure your DMs are open for this server.)',
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }
    }

    return new Response('Unknown interaction', { status: 400 });
  },
};