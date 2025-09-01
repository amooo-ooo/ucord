import { Client } from 'discord.js-selfbot-v13';
import { respond, sanitizeContent } from './services/ai';

const client = new Client();

client.once('ready', async () => {
  if (client.user) {
    await client.user.setPresence({ status: 'online' });
    console.log(`${client.user.username} is ready!`);
  }
});

async function buildContext(message: any) {
  const recentMessages = await message.channel.messages.fetch({ limit: 16 });
  const messages = recentMessages
    .filter((msg: any) => msg.content)
    .map((msg: any) => {
      const isAssistant = msg.author.id === client.user?.id;
      const content = isAssistant
        ? msg.content
        : `<user: ${msg.author.displayName || msg.author.username}, channel_type: ${msg.channel.type}>: ${msg.content}`;

      const messageObj: any = {
        role: isAssistant ? 'assistant' : 'user',
        content: content,
      };

      return messageObj;
    })
    .filter(Boolean)
    .reverse();

  return messages;
}

client.on('messageCreate', async (message: any) => {
  if (!client.user || (process.env.CHANNEL && message.channel.id !== process.env.CHANNEL)) return;
  console.log(`${message.member?.displayName || message.author.username}: ${message.content}`);

  if (message.author.id === client.user.id) return;

  try {
    let messages = await buildContext(message);
    message.channel.sendTyping();

    const maxChains = 12;
    for (let i = 0; i < maxChains; i++) {
      const reply = sanitizeContent(await respond(messages, message));
      if (!reply || reply === messages.at(-1)?.content) return;

      await message.channel.send(reply);
      messages.push({
        role: 'assistant',
        content: reply,
      });
    }
  } catch (err) {
    console.error('Error getting AI response:', err);
  }
});

client.login(process.env.AUTH_TOKEN);
