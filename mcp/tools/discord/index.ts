import type { Tool } from '../../types';
import type { Message } from 'discord.js-selfbot-v13';

export const discordReply: Tool = {
    name: "reply_to_message",
    description: "Reply to a specific message in the current channel. Only use when relevant.",
    parameters: {
        type: "object",
        properties: {
            id: {
                type: "string",
                description: "ID of message to reply to."
            },
            message: {
                type: "string",
                description: "Text content to send as the reply."
            }
        },
        required: ["id", "message"],
    },
    handler: async (args: Record<string, any>, originalMessage?: string, context?: any): Promise<string> => {
        const { id, message: replyContent } = args;

        if (!context || !context.channel) {
            return "Error: Channel context not provided. Cannot fetch or reply to the message.";
        }
        if (!id || !replyContent) {
            return "Error: Both 'id' and 'message' parameters are required.";
        }

        try {
            const targetMessage: Message = await context.channel.messages.fetch(id);

            await targetMessage.reply(replyContent);

            return `Successfully replied to message ID ${id} with content: "${replyContent}"`;

        } catch (error) {
            console.error("Failed to reply to message:", error);

            if (error instanceof Error) {
                return `Failed to reply to message ID ${id}: ${error.message}`;
            }
            return `Failed to reply to message ID ${id}: An unknown error occurred.`;
        }
    }
};

export const discordReact: Tool = {
    name: "react_to_message",
    description: "React to a specific message with one or more standard unicode emojis. Does not work with ascii emoticons.",
    parameters: {
        type: "object",
        properties: {
            id: {
                type: "string",
                description: "ID of message to react to."
            },
            reactions: {
                type: "array",
                description: "Array of unicode emojis as reactions.",
                items: {
                    type: "string"
                }
            }
        },
        required: ["id", "reactions"],
    },
    handler: async (args: Record<string, any>, originalMessage?: string, context?: any): Promise<string> => {
        const { id, reactions } = args;

        if (!context || !context.channel) {
            return "Error: Channel context not provided. Cannot fetch or react to the message.";
        }
        if (!id || !reactions) {
            return "Error: Both 'id' and 'reactions' parameters are required.";
        }
        if (!Array.isArray(reactions) || reactions.length === 0) {
            return "Error: The 'reactions' parameter must be a non-empty array of emojis.";
        }

        try {
            const targetMessage: Message = await context.channel.messages.fetch(id);

            // React with each emoji one by one to avoid rate-limiting issues.
            for (const emoji of reactions) {
                await targetMessage.react(emoji);
            }

            const emojiList = reactions.join(', ');
            return `Successfully reacted to message ID ${id} with emojis: ${emojiList}`;

        } catch (error) {
            console.error("Failed to react to message:", error);

            if (error instanceof Error) {
                // This could fail due to an invalid emoji, an unknown message ID, or missing permissions.
                return `Failed to react to message ID ${id}: ${error.message}`;
            }
            return `Failed to react to message ID ${id}: An unknown error occurred.`;
        }
    }
};
