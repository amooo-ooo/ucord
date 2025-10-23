import fetch from 'node-fetch';
import type { Tool } from '../../types';

export const webSearch: Tool = {
    name: "web_search",
    description: "Search the web for a query",
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "The search query" },
        },
        required: ["query"],
    },
    handler: async (args: Record<string, any>): Promise<string> => {
        try {
            const response = await fetch(
                `https://brave.amorb.dev/search?q=${encodeURIComponent(args.query)}`
            );

            if (!response.ok) {
                throw new Error(`API responded with status: ${response.status}`);
            }

            const data = await response.json();
            return data?.result || "No results found.";
        } catch (error) {
            if (error instanceof Error) {
                return `Failed to get web search results: ${error.message}`;
            }
            return `Failed to get web search results: Unknown error`;
        }
    }
};
