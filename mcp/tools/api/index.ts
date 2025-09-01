import type { Tool } from '../../types';

export const tool: Tool = {
    name: "call_api",
    description: "Makes an HTTP request to a specified API endpoint **for real-time data, or refresh the latest information (2025)** and returns the response. Supports different methods, headers, and request bodies. Useful for fetching data from free api's without authentication, e.g. **Jikan (anime), CoinGecko, Yahoo Finance (query1.finance.yahoo.com/v8), Wikimedia (General), Open Street Map, MusicBrainz (Music).**",
    parameters: {
        type: "object",
        properties: {
            url: {
                type: "string",
                description: "The URL of the API endpoint to call."
            },
            method: {
                type: "GET | POST | PUT | DELETE | PATCH | HEAD | OPTIONS",
                description: "The HTTP method to use. Defaults to GET.",
            },
            headers: {
                type: "object",
                description: "A JSON object containing the request headers."
            },
            body: {
                type: "object",
                description: "A JSON object containing the request body."
            }
        },
        required: ["url"],
    },
    handler: async (args: Record<string, any>): Promise<string> => {
        const { url, method = 'GET', headers = {}, body } = args;

        if (!url) {
            return "Error: No URL was provided to call.";
        }

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: body ? JSON.stringify(body) : undefined,
            });

            const responseBody = await response.text();

            if (!response.ok) {
                return `Error: API call failed with status ${response.status} ${response.statusText}\n\nResponse Body:\n${responseBody}`;
            }

            return `Status: ${response.status} ${response.statusText}\n\nResponse Body:\n${responseBody}`;

        } catch (error: any) {
            return `Error making API call: ${error.message}`;
        }
    }
};

export default tool;