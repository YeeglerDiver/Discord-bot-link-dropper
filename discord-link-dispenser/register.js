const TOKEN = process.env.DISCORD_TOKEN;
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;

const commands = [
  {
    name: 'setup',
    description: 'Post the Link Dispenser embed and button in this channel',
    default_member_permissions: '8',
  },
];

async function registerCommands() {
  const url = `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (response.ok) {
    console.log('Successfully registered /setup command!');
  } else {
    console.error('Error registering commands:', await response.text());
  }
}

registerCommands();