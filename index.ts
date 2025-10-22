import { Client, Message } from 'discord.js-selfbot-v13';
import { respond, sanitizeContent, describeImage } from './services/ai';

const client = new Client();

const imageDescriptionCache = new Map<string, string>();

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
    const timestamp = formatTimestamp(msg.createdTimestamp);
    const messageText = msg.content || '';
    let attachmentContent = '';

    if (msg.attachments.size > 0) {
        const imageAttachment = msg.attachments.find(att => att.contentType?.startsWith('image/'));
        if (imageAttachment && imageAttachment.contentType) {
            
            const cacheKey = `${msg.id}-${imageAttachment.id}`;
            let description = '';

            if (imageDescriptionCache.has(cacheKey)) {
                description = imageDescriptionCache.get(cacheKey)!;
                console.log(`[Cache] HIT for attachment ${imageAttachment.id}. Using cached description.`);
            } else {
                console.log(`[Cache] MISS for attachment ${imageAttachment.id}. Fetching new description...`);
                try {
                    const response = await fetch(imageAttachment.url);
                    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
                    const imageArrayBuffer = await response.arrayBuffer();
                    const base64Image = Buffer.from(imageArrayBuffer).toString('base64');
                    
                    description = await describeImage(base64Image, imageAttachment.contentType);
                    
                    imageDescriptionCache.set(cacheKey, description);
                    console.log(`[Cache] SET for attachment ${imageAttachment.id}.`);

                } catch (error) {
                    console.error(`Failed to process image attachment:`, error);
                    description = "[Image failed to process]";
                }
            }
            
            attachmentContent = `\n<attachment type="${imageAttachment.contentType}">${description}</attachment>`;
        }
    }

    const fullContent = `${messageText}${attachmentContent}`;

    if (msg.reference && msg.reference.messageId) {
        const originalMsgId = msg.reference.messageId;
        let originalMsg: Message | undefined;
        let content: string;
        let originalAuthorName = 'Unknown User';

        if (recentMessagesMap.has(originalMsgId)) {
            originalMsg = recentMessagesMap.get(originalMsgId);
            let snippet = (originalMsg.content || '').substring(0, 80);
            if ((originalMsg.content || '').length > 80) snippet += '...';
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
        
        const replyBlock = `\n  <reply to_user="${originalAuthorName}" to_message_id="${originalMsgId}">\n${content}\n  </reply>`;
        return `<msg id="${msg.id}" timestamp="${timestamp}">${replyBlock}\n${fullContent}\n</msg>`;
    } else {
        return `<msg id="${msg.id}" timestamp="${timestamp}">${fullContent}</msg>`;
    }
}

function formatUserGroup(channel_type: string, author: string, messages: string): string {
    return `<user name="${author}" channel_type="${channel_type}">\n${messages}\n</user>`;
}

async function buildContext(message: Message): Promise<any[]> {
    const recentMessages = await message.channel.messages.fetch({ limit: 16 });
    const orderedMessages = recentMessages.filter((msg) => msg.content || msg.attachments.size > 0).reverse();

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
            const author = group.messages[0].author.displayName ?? group.messages[0].author.username;
            const channel_type = message.channel.type;
            content = formatUserGroup(channel_type,author, formattedMessageLines.join('\n'));
        }
        return { role, content };
    }));

    return finalContext;
}

client.on('messageCreate', async (message: Message) => {
    if (!client.user || (process.env.CHANNEL && message.channel.id !== process.env.CHANNEL)) return;
    
    if (message.author.id === client.user.id || (message.content === "" && message.attachments.size === 0)) return;

    console.log(`${message.member?.displayName || message.author.username}: ${message.content}`);

    try {
        let messages = await buildContext(message);
        await message.channel.sendTyping();

        const maxChains = 6;
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
