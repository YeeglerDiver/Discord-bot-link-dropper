import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
  verifyKey,
} from 'discord-interactions';

const DEFAULT_LINKS = [
  'https://example.com/link-1',
  'https://example.com/link-2',
];

function getTrulyRandomLink(links, lastLink) {
  const pool = links.length > 1 && lastLink
    ? links.filter((l) => l !== lastLink)
    : [...links];

  const array = new Uint32Array(pool.length);
  crypto.getRandomValues(array);

  for (let i = pool.length - 1; i > 0; i--) {
    const j = array[i] % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool[0];
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

    if (interaction.type === InteractionType.PING) {
      return Response.json({ type: InteractionResponseType.PONG });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const commandName = interaction.data.name;

      if (commandName === 'setup') {
        return Response.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [
              {
                title: 'Link Dispenser',
                description: 'Click the button below to get a random link sent to your DMs.',
                color: 0x9b59b6,
              },
            ],
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    style: 3,
                    label: 'Random Link',
                    custom_id: 'dispense_random_link',
                  },
                ],
              },
            ],
          },
        });
      }

      if (commandName === 'uploadlinks') {
        const rawInput = interaction.data.options?.[0]?.value || '';
        const parsedLinks = rawInput
          .split(/[\s,]+/)
          .map((link) => link.trim())
          .filter((link) => link.startsWith('http://') || link.startsWith('https://'));

        const uniqueLinks = [...new Set(parsedLinks)];

        if (uniqueLinks.length === 0) {
          return Response.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: 'No valid links found. Make sure links start with `https://` or `http://`.',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        await env.LINKS_KV.put('active_batch', JSON.stringify(uniqueLinks));

        return Response.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Deleted the previous batch and uploaded **${uniqueLinks.length}** unique links!`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      if (commandName === 'clearlinks') {
        await env.LINKS_KV.delete('active_batch');

        return Response.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Previous link batch deleted. The dispenser is now empty until you run `/uploadlinks`.',
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }
    }

    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      if (interaction.data.custom_id === 'dispense_random_link') {
        const storedBatch = await env.LINKS_KV.get('active_batch');
        const allLinks = storedBatch ? JSON.parse(storedBatch) : DEFAULT_LINKS;

        if (!allLinks || allLinks.length === 0) {
          return Response.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: 'No links are currently stocked! Check back later.',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        if (!env.DISCORD_TOKEN) {
          return Response.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: 'Error: `DISCORD_TOKEN` secret is missing in Cloudflare!',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        const userId = interaction.member?.user?.id || interaction.user?.id;
        const lastKey = `last_${userId}`;
        const lastLink = await env.LINKS_KV.get(lastKey);

        const randomLink = getTrulyRandomLink(allLinks, lastLink);
        await env.LINKS_KV.put(lastKey, randomLink);

        const dmChannelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
          method: 'POST',
          headers: {
            Authorization: `Bot ${env.DISCORD_TOKEN.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ recipient_id: userId }),
        });

        if (!dmChannelRes.ok) {
          const errText = await dmChannelRes.text();
          return Response.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `Failed to open DM (${dmChannelRes.status}): \`${errText}\``,
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        const dmChannel = await dmChannelRes.json();

        const msgRes = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${env.DISCORD_TOKEN.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: `Here is your link: ${randomLink}` }),
        });

        if (!msgRes.ok) {
          const errText = await msgRes.text();
          return Response.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `Could not send DM (${msgRes.status}): Make sure DMs are enabled for this server! (\`${errText}\`)`,
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        return Response.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Check your DMs!',
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }
    }

    return new Response('Unknown interaction', { status: 400 });
  },
};