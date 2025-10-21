import { Client } from 'discord.js-selfbot-v13';
import { respond, sanitizeContent } from './services/ai';

const client = new Client();

client.once('ready', async () => {
  if (client.user) {
    await client.user.setPresence({ status: 'online' });
    console.log(`${client.user.username} is ready!`);
  }
});

function formatTimestamp(unixTimestamp: number): string {
  const date = new Date(unixTimestamp);
  
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',    
    month: 'short',
    year: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true,      
  };

  return date.toLocaleString('en-GB', options).replace(',', '');
}

function formatSingleMessage(msg: any): string {
  return `<message id="${msg.id}" timestamp="${formatTimestamp(msg.createdTimestamp)}">${msg.content}</message>`;
}

function formatUserGroup(author: any, channel: any, messages: string): string {
  const user = author.displayName || author.username;
  return `<user name="${user}" channel_type="${channel.type}">\n${messages}\n</user>`;
}

async function buildContext(message: any): Promise<any[]> {
  const recentMessages = await message.channel.messages.fetch({ limit: 16 });

  const orderedMessages = recentMessages
    .filter((msg: any) => msg.content)
    .reverse();

  if (orderedMessages.length === 0) {
    return [];
  }

  const groupedByUser = orderedMessages.reduce((acc, msg) => {
    const lastGroup = acc.length > 0 ? acc[acc.length - 1] : null;
    const isAssistant = msg.author.id === client.user?.id;

    if (lastGroup && lastGroup.author.id === msg.author.id) {
      lastGroup.messages.push(msg);
    } else {
      acc.push({
        author: msg.author,
        channel: msg.channel,
        isAssistant: isAssistant,
        messages: [msg],
      });
    }
    return acc;
  }, []);

  const finalContext = groupedByUser.map(group => {
    const role = group.isAssistant ? 'assistant' : 'user';

    let content;
    if (role === 'assistant') {
      content = group.messages[0].content;
    } else {
      const formattedMessageLines = group.messages
        .map(formatSingleMessage)
        .join('\n');
        
      content = formatUserGroup(group.author, group.channel, formattedMessageLines);
    }

    return { role, content };
  });

  return finalContext;
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
