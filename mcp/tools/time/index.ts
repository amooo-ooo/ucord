import type { Tool } from '../../types';
import { logger } from '../../../utils/logger';

export const getCurrentTime: Tool = {
    name: "get_current_time",
    description: "Get the current date and time.",
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
    handler: async () => {
        const now = new Date();
        return `Current time: ${now.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'long' })}`;
    }
};

export const getMessageTimestamp: Tool = {
    name: "get_message_timestamp",
    description: "Get the timestamp of a specific message.",
    parameters: {
        type: "object",
        properties: {
            message_id: { type: "string", description: "The ID of the message." }
        },
        required: ["message_id"],
    },
    handler: async (args: Record<string, any>, originalMessage?: string, context?: any) => {
        const { message_id } = args;
        if (!context || !context.channel) {
            return "Error: Channel context not provided.";
        }

        try {
            const message = await context.channel.messages.fetch(message_id);
            if (!message) return `Message with ID ${message_id} not found.`;

            const date = new Date(message.createdTimestamp);
            return `Message ${message_id} was sent on: ${date.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'long' })}`;
        } catch (error) {
            logger.error(`Failed to fetch message timestamp for ${message_id}:`, error);
            return `Failed to fetch timestamp for message ${message_id}.`;
        }
    }
};
