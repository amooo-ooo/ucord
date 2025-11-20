import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { handleToolCalls, parseMakeshiftToolCalls, toolsDescription } from '../mcp/index';
import { logger } from '../utils/logger';

const TOOLS_PROMPT = `You have access to the following tools:\n${toolsDescription}\n\n` + readFileSync('./prompts/tools.txt', 'utf-8');
const SYSTEM_PROMPT = `${readFileSync('./prompts/prompt.txt', 'utf-8')}\n\n${readFileSync('./prompts/format.txt', 'utf-8')}\n\n${TOOLS_PROMPT}`;

const MODEL_SETTINGS = [
    { model: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', temperature: 0.6, top_p: 0.7, max_tokens: 4096, stream: false as const },
    { model: "nvidia/llama-3.3-nemotron-super-49b-v1.5", temperature: 0.6, top_p: 0.95, max_tokens: 65536, stream: false as const },
    { model: "meta/llama-4-maverick-17b-128e-instruct", temperature: 0.50, top_p: 1.00, max_tokens: 4096, stream: false as const }
];

let model = 0;
let visionModelSettings = MODEL_SETTINGS[2];
const timeout = 10000;
const switchOnTimeout = false;

const openai = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
});

export async function describeImage(base64Image: string, contentType: string): Promise<string> {
    logger.debug("Requesting image description from vision model...");
    try {
        const response = await openai.chat.completions.create({
            ...visionModelSettings,
            messages: [{ role: "user", content: `Describe in great detail the contents of the following image including any text. Be objective and comprehensive. <img src="data:${contentType};base64,${base64Image}" />` }],
        });
        const description = response.choices[0]?.message?.content?.trim();
        if (!description) throw new Error("Received an empty description from the vision model.");
        logger.debug("Successfully generated image description.");
        logger.debug(`Image Description: ${description}`);
        return description;
    } catch (error) {
        logger.error("Error generating image description:", error);
        return "[Image description failed to generate]";
    }
}

export async function createCompletion(options: any) {
    let attempts = 0;
    const maxAttempts = switchOnTimeout ? MODEL_SETTINGS.length : 1;
    while (attempts < maxAttempts) {
        attempts++;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const response = await openai.chat.completions.create({ ...MODEL_SETTINGS[model], ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            // Sanitization removed from here to allow raw logging in handleResponse
            return response;
        } catch (error: any) {
            const isTimeout = error.name === 'AbortError' || error.message === 'Timeout';
            if (isTimeout && switchOnTimeout && attempts < maxAttempts) {
                logger.info(`API call timed out after ${timeout}ms. Switching model and retrying.`);
                model = (model + 1) % MODEL_SETTINGS.length;
                continue;
            }
            if (isTimeout) throw new Error('Timeout');
            throw error;
        }
    }
    throw new Error('Failed to create completion after all attempts');
}

async function handleResponse(response: OpenAI.Chat.Completions.ChatCompletion | null, messages: any[], context: any): Promise<string> {
    if (!response) return '';
    const message = response.choices[0].message;

    let thinking = (message as any).reasoning_content;
    if (!thinking) {
        const thinkingMatch = message.content?.match(/<think>([\s\S]*?)(?:<\/think>|<\\think>)/i);
        if (thinkingMatch) {
            thinking = thinkingMatch[1].trim();
        }
    }

    if (thinking) {
        logger.info(`Received model thinking: ${thinking}`);
    }

    const responseText = sanitizeReasoning(message);
    logger.info(`Received model content: ${responseText}`);

    const { hasTools, toolCalls, leftoverText } = parseMakeshiftToolCalls(responseText);

    if (hasTools && toolCalls) {
        logger.debug("Handling makeshift tool calls...");
        const toolResults = await handleToolCalls(toolCalls, messages, context);
        const followUpMessages = [...messages, { role: 'assistant', content: responseText }, ...toolResults];
        const followUpResponse = await createCompletion({ messages: followUpMessages });
        const finalResponse = await handleResponse(followUpResponse, followUpMessages, context);
        return finalResponse || leftoverText;
    }

    return leftoverText;
}

export async function respond(messageHistory: any[], context: any): Promise<string> {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messageHistory];
    try {
        logger.debug("Making API call for makeshift tool response...");
        const response = await createCompletion({ messages });
        return await handleResponse(response, messages, context);
    } catch (error: any) {
        if (error.message === 'Timeout') {
            return 'The AI has timed out.';
        }
        logger.error("An unhandled error occurred:", error);
        throw error;
    }
}

export function sanitizeContent(text: string): string {
    if (!text) return '';
    return text.replace(/<NULL>/gi, '').trim();
}

export function sanitizeReasoning(text: OpenAI.Chat.Completions.ChatCompletionMessage): string {
    let response = text.content;
    if (!response && (text as any).reasoning_content) {
        response = sanitizeContent((text as any).reasoning_content);
    }
    return response?.replace(/<think>[\s\S]*?(<\/think>|<\\think>)/gi, '').trim() || '';
}
