import { Client, Message } from 'discord.js-selfbot-v13';
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
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    };
    return date.toLocaleString('en-GB', options).replace(',', '');
}

async function formatSingleMessage(msg: Message, recentMessagesMap: Map<string, Message>): Promise<string> {
    const authorName = msg.author.displayName || msg.author.username;
    const timestamp = formatTimestamp(msg.createdTimestamp);

    if (msg.reference && msg.reference.messageId) {
        const originalMsgId = msg.reference.messageId;
        let originalMsg: Message | undefined;
        let content: string;
        let originalAuthorName = 'Unknown User';

        if (recentMessagesMap.has(originalMsgId)) {
            originalMsg = recentMessagesMap.get(originalMsgId);
            let snippet = originalMsg.content.substring(0, 80);
            if (originalMsg.content.length > 80) snippet += '...';
            content = snippet;
        } else {
            try {
                originalMsg = await msg.channel.messages.fetch(originalMsgId);
                content = originalMsg.content;
            } catch (error) {
                console.error(`Failed to fetch out-of-context message ID ${originalMsgId}:`, error);
                content = "[Message content not available]";
            }
        }

        if (originalMsg) {
            originalAuthorName = originalMsg.author.displayName || originalMsg.author.username;
        }
        
        const replyBlock = `\n  <reply to_user="${originalAuthorName}" to_message_id="${originalMsgId}">\n    ${content}\n  </reply>`;
        return `<msg id="${msg.id}" author="${authorName}" timestamp="${timestamp}">${replyBlock}\n  ${msg.content}\n</msg>`;
    } else {
        return `<msg id="${msg.id}" author="${authorName}" timestamp="${timestamp}">${msg.content}</msg>`;
    }
}

function formatUserGroup(messages: string): string {
    return `<user>\n${messages}\n</user>`;
}

async function buildContext(message: Message): Promise<any[]> {
    const recentMessages = await message.channel.messages.fetch({ limit: 16 });
    const orderedMessages = recentMessages.filter((msg) => msg.content).reverse();

    if (orderedMessages.length === 0) return [];

    const recentMessagesMap = new Map(orderedMessages.map(msg => [msg.id, msg]));

    const groupedByUser = orderedMessages.reduce((acc: any[], msg) => {
        const lastGroup = acc.length > 0 ? acc[acc.length - 1] : null;
        const isAssistant = msg.author.id === client.user?.id;

        if (lastGroup && !lastGroup.isAssistant && lastGroup.messages[0].author.id === msg.author.id) {
            lastGroup.messages.push(msg);
        } else {
            acc.push({ isAssistant, messages: [msg] });
        }
        return acc;
    }, []);

    const finalContext = await Promise.all(groupedByUser.map(async (group) => {
        const role = group.isAssistant ? 'assistant' : 'user';
        let content;

        if (role === 'assistant') {
            content = group.messages[0].content;
        } else {
            const formattedMessageLines = await Promise.all(
                group.messages.map(msg => formatSingleMessage(msg, recentMessagesMap))
            );
            content = formatUserGroup(formattedMessageLines.join('\n'));
        }
        return { role, content };
    }));

    return finalContext;
}

client.on('messageCreate', async (message: Message) => {
    if (!client.user || (process.env.CHANNEL && message.channel.id !== process.env.CHANNEL)) return;
    
    if (message.author.id === client.user.id) return;

    console.log(`${message.member?.displayName || message.author.username}: ${message.content}`);

    try {
        let messages = await buildContext(message);
        await message.channel.sendTyping();

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
