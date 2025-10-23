import { Client, Message } from 'discord.js-selfbot-v13';
import * as mj from 'mathjax-node';
import sharp from 'sharp';
import { respond, sanitizeContent, describeImage } from './services/ai';

interface MessageChunk {
    type: 'text' | 'latex' | 'image';
    content: string;
    altText?: string;
}

const client = new Client();
const imageDescriptionCache = new Map<string, string>();

mj.config({
    MathJax: { TeX: { extensions: ["color.js"] } }
});
mj.start();

client.once('ready', async () => {
    if (client.user) {
        await client.user.setPresence({ status: 'online' });
        console.log(`${client.user.username} is ready!`);
    }
});

// TODO: add reply chunking to utils, and add chunking + latex for reply tool
async function* constructReplyChunks(reply: string): AsyncGenerator<MessageChunk> {
    const regex = /(\$\$[\s\S]*?\$\$|!\[(.*?)\]\((.*?)\))/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(reply)) !== null) {
        if (match.index > lastIndex) {
            yield { type: 'text', content: reply.substring(lastIndex, match.index) };
        }

        if (match[1].startsWith('$$')) {
            yield { type: 'latex', content: match[1] };
        } else {
            yield { type: 'image', content: match[3], altText: match[2] };
        }

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < reply.length) {
        yield { type: 'text', content: reply.substring(lastIndex) };
    }
}

async function convertLatexToImage(latex: string): Promise<Buffer> {
    console.log(`Rendering LaTeX: ${latex}`);

    const SCALE_FACTOR = 1.3;

    const spacedLatex = latex.replace(/\\\\/g, '\\\\[0.4em]');

    const mathInput = `\\color{white}{${spacedLatex}}`;

    const data = await mj.typeset({
        math: mathInput,
        format: 'TeX',
        svg: true,
    });

    if (data.errors) {
        console.error('MathJax rendering error:', data.errors);
        throw new Error(`MathJax rendering failed: ${data.errors}`);
    }
    if (!data.svg) {
        throw new Error('MathJax did not return SVG data.');
    }

    const latexImage = sharp(Buffer.from(data.svg));
    const metadata = await latexImage.metadata();
    
    const scaledWidth = Math.ceil((metadata.width || 0) * SCALE_FACTOR);
    const scaledLatexBuffer = await latexImage.resize(scaledWidth).toBuffer();

    const paddingX = 8; 
    const paddingY = 8;
    const scaledMetadata = await sharp(scaledLatexBuffer).metadata();

    const canvasWidth = (scaledMetadata.width || 0) + paddingX * 2;
    const canvasHeight = (scaledMetadata.height || 0) + paddingY * 2;

    const transparentBackground = await sharp({
        create: {
            width: canvasWidth,
            height: canvasHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .png()
    .toBuffer();

    return sharp(transparentBackground)
        .composite([{ 
            input: scaledLatexBuffer,
            top: paddingY,
            left: paddingX
        }])
        .png()
        .toBuffer();
}

async function sendReplyInChunks(message: Message, reply: string) {
    for await (const chunk of constructReplyChunks(reply)) {
        try {
            switch (chunk.type) {
                case 'text':
                    if (chunk.content.trim()) await message.channel.send(chunk.content);
                    break;
                case 'latex':
                    const latex = chunk.content.slice(2, -2).trim();
                    const imageBuffer = await convertLatexToImage(latex);
                    await message.channel.send({ files: [{ attachment: imageBuffer, name: 'latex.png', description: latex }] });
                    break;
                case 'image':
                    await message.channel.send({ content: chunk.altText || undefined, files: [chunk.content] });
                    break;
            }
        } catch (err) {
            console.error('Failed to send a message chunk:', err.message || err);
        }
    }
}

function formatTimeAgo(unixTimestamp: number): string {
    const seconds = Math.floor((Date.now() - unixTimestamp) / 1000);
    const intervals = [
        { label: 'y', seconds: 31536000 },
        { label: 'mo', seconds: 2592000 },
        { label: 'd', seconds: 86400 },
        { label: 'h', seconds: 3600 },
        { label: 'm', seconds: 60 },
        { label: 's', seconds: 1 },
    ];

    for (const interval of intervals) {
        const count = Math.floor(seconds / interval.seconds);
        if (count >= 1) return `${count}${interval.label} ago`;
    }
    return 'just now';
}

function formatTimestamp(unixTimestamp: number): string {
    const date = new Date(unixTimestamp);
    const options: Intl.DateTimeFormatOptions = {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    };
    const absoluteTime = date.toLocaleString('en-GB', options).replace(',', '');
    return `${absoluteTime} (${formatTimeAgo(unixTimestamp)})`;
}

async function processAttachment(msg: Message): Promise<string> {
    const imageAttachment = msg.attachments.find(att => att.contentType?.startsWith('image/'));
    if (!imageAttachment?.contentType) return '';

    const cacheKey = `${msg.id}-${imageAttachment.id}`;
    if (imageDescriptionCache.has(cacheKey)) {
        console.log(`[Cache] HIT for attachment ${imageAttachment.id}.`);
        return `\n<attachment type="${imageAttachment.contentType}">${imageDescriptionCache.get(cacheKey)}</attachment>`;
    }

    console.log(`[Cache] MISS for attachment ${imageAttachment.id}. Fetching...`);
    try {
        const response = await fetch(imageAttachment.url);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

        const imageArrayBuffer = await response.arrayBuffer();
        const base64Image = Buffer.from(imageArrayBuffer).toString('base64');
        const description = await describeImage(base64Image, imageAttachment.contentType);

        imageDescriptionCache.set(cacheKey, description);
        console.log(`[Cache] SET for attachment ${imageAttachment.id}.`);
        return `\n<attachment type="${imageAttachment.contentType}">${description}</attachment>`;
    } catch (error) {
        console.error(`Failed to process image attachment:`, error);
        return `\n<attachment type="${imageAttachment.contentType}">[Image failed to process]</attachment>`;
    }
}

async function formatReplyBlock(msg: Message, recentMessagesMap: Map<string, Message>): Promise<string> {
    if (!msg.reference?.messageId) return '';

    const { messageId } = msg.reference;
    let originalMsg: Message | undefined = recentMessagesMap.get(messageId);
    let content = "[Message content not available]";

    if (!originalMsg) {
        try {
            originalMsg = await msg.channel.messages.fetch(messageId);
        } catch (error) {
            console.error(`Failed to fetch out-of-context message ID ${messageId}:`, error);
        }
    }

    if (originalMsg?.content) {
        content = originalMsg.content.substring(0, 80) + (originalMsg.content.length > 80 ? '...' : '');
    }

    const authorName = originalMsg?.author.displayName ?? originalMsg?.author.username ?? 'Unknown User';
    return `\n  <reply to_user="${authorName}" to_message_id="${messageId}">\n${content}\n  </reply>`;
}

async function formatSingleMessage(msg: Message, recentMessagesMap: Map<string, Message>): Promise<string> {
    const timestamp = formatTimestamp(msg.createdTimestamp);
    const attachmentContent = await processAttachment(msg);
    const replyBlock = await formatReplyBlock(msg, recentMessagesMap);
    const fullContent = `${msg.content ?? ''}${attachmentContent}`;

    return `<msg id="${msg.id}" timestamp="${timestamp}">${replyBlock}${replyBlock ? '\n' : ''}${fullContent}\n</msg>`;
}

async function buildContext(message: Message): Promise<{ role: string; content: string }[]> {
    const recentMessages = await message.channel.messages.fetch({ limit: 16 });
    const orderedMessages = Array.from(recentMessages.values())
        .filter(msg => msg.content || msg.attachments.size > 0)
        .reverse();

    if (orderedMessages.length === 0) return [];

    const recentMessagesMap = new Map(orderedMessages.map(msg => [msg.id, msg]));

    const groupedByUser: { isAssistant: boolean; messages: Message[] }[] = orderedMessages.reduce((acc, msg) => {
        const lastGroup = acc[acc.length - 1];
        const isAssistant = msg.author.id === client.user?.id;

        if (lastGroup && !lastGroup.isAssistant && lastGroup.messages[0].author.id === msg.author.id) {
            lastGroup.messages.push(msg);
        } else {
            acc.push({ isAssistant, messages: [msg] });
        }
        return acc;
    }, [] as { isAssistant: boolean; messages: Message[] }[]);

    return Promise.all(groupedByUser.map(async (group) => {
        const role = group.isAssistant ? 'assistant' : 'user';
        if (role === 'assistant') {
            return { role, content: group.messages[0].content };
        }

        const formattedMessages = await Promise.all(group.messages.map(msg => formatSingleMessage(msg, recentMessagesMap)));
        const author = group.messages[0].author.displayName ?? group.messages[0].author.username;
        const userGroupContent = `<user name="${author}" channel_type="${message.channel.type}">\n${formattedMessages.join('\n')}\n</user>`;

        return { role, content: userGroupContent };
    }));
}

client.on('messageCreate', async (message: Message) => {
    if (!client.user || message.author.id === client.user.id || (process.env.CHANNEL && message.channel.id !== process.env.CHANNEL)) return;
    if (message.content === "" && message.attachments.size === 0) return;

    console.log(`${message.member?.displayName ?? message.author.username}: ${message.content}`);

    try {
        const messages = await buildContext(message);
        await message.channel.sendTyping();

        const maxChains = 6;
        for (let i = 0; i < maxChains; i++) {
            const reply = sanitizeContent(await respond(messages, message));
            if (!reply || reply === messages[messages.length - 1]?.content) return;

            await sendReplyInChunks(message, reply);
            messages.push({ role: 'assistant', content: reply });
        }
    } catch (err) {
        console.error('Error during AI response generation:', err);
    }
});

client.login(process.env.AUTH_TOKEN);
