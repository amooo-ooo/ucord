import type { Tool } from '../../types';
import fetch from 'node-fetch';

export const searchGifs: Tool = {
    name: "search_gifs",
    description: "Search for GIFs on Tenor. Returns list of GIFs and their URLs to send to chat. Favourite tags include: onimai, bocchi, anime, boykisser",
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "Search term for the GIF (e.g., 'anime sob', 'bocchi dead')."
            }
        },
        required: ["query"],
    },
    handler: async (args: Record<string, any>): Promise<string> => {
        const { query } = args;
        const apiKey = "LIVDSRZULELA"; // Public Tenor API key
        const limit = 8;

        if (!query) {
            return "Error: A search query must be provided to find GIFs.";
        }

        const url = `https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${apiKey}&limit=${limit}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Tenor API responded with status ${response.status}: ${errorBody}`);
            }

            const data: any = await response.json();

            if (!data.results || data.results.length === 0) {
                return `No GIFs were found for the query: "${query}"`;
            }

            const simplifiedResults = data.results.map((result: any, index: number) => {
                const gifUrl = result.media[0]?.gif?.url || result.media[0]?.tinygif?.url || result.url;
                
                return {
                    choice_id: index + 1,
                    description: result.content_description || "A relevant GIF.",
                    url: gifUrl
                };
            });
            
            return `[GIF Search Results for "${query}"]:\n${JSON.stringify(simplifiedResults, null, 2)}`;

        } catch (error) {
            console.error("Failed to search for GIFs:", error);
            if (error instanceof Error) {
                return `Failed to search for GIFs: ${error.message}`;
            }
            return `Failed to search for GIFs: An unknown error occurred.`;
        }
    }
};
