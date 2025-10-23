import { chromium, type Browser } from 'playwright';
import fetch from 'node-fetch';
import type { Tool } from '../../types';

export const webSearch: Tool = {
    name: "web_search",
    description: "Search the web for a query.",
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "The search query" },
        },
        required: ["query"],
    },
    handler: async (args: Record<string, any>): Promise<string> => {
        if (!args.query) {
            return "Failed to get web search results: No query provided.";
        }

        try {
            const response = await fetch(
                `https://brave.amorb.dev/search?q=${encodeURIComponent(args.query)}`
            );

            if (!response.ok) {
                throw new Error(`API responded with status: ${response.status}`);
            }

            const data = await response.json();
            const result = data?.result;

            if (result) {
                return result;
            }
            
            throw new Error("No results found from API, trying fallback...");

        } catch (error) {
            console.log(`Fetch API failed: ${error instanceof Error ? error.message : 'Unknown error'}. Falling back to Playwright.`);

            let browser: Browser | null = null;
            try {
                browser = await chromium.launch({ headless: true });

                const context = await browser.newContext({
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
                    permissions: ['clipboard-read', 'clipboard-write'],
                });

                const page = await context.newPage();
                await page.goto(`https://search.brave.com/ask?q=${encodeURIComponent(args.query)}&source=web`);

                await page.waitForSelector('div.answering-label:has-text("Finished")', { timeout: 45000 });
                await page.click('.tap-round-footer > button:first-child');

                const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
                await browser.close();

                return clipboardText || "No results found from Playwright.";

            } catch (playwrightError) {
                if (browser) {
                    await browser.close();
                }

                if (playwrightError instanceof Error) {
                    if (playwrightError.name === 'TimeoutError') {
                        return `Playwright fallback failed: The operation timed out.`;
                    }
                    return `Playwright fallback failed: ${playwrightError.message}`;
                }
                return `Playwright fallback failed: An unknown error occurred.`;
            }
        }
    }
};
