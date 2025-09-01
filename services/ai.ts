import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { tools, handleToolCalls, parseMakeshiftToolCall, toolsDescription } from '../mcp/index';

const TOOLS_PROMPT = `You have access to the following tools:\n${toolsDescription}\n\n` + readFileSync('./prompts/tools.txt', 'utf-8');
const SYSTEM_PROMPT = `${readFileSync('./prompts/prompt.txt', 'utf-8')}\n\n${readFileSync('./prompts/format.txt', 'utf-8')}\n\n${TOOLS_PROMPT}`;

const MODEL_SETTINGS = [
  {
    model: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    temperature: 0.6,
    top_p: 0.7,
    max_tokens: 4096,
    stream: false,
  },
  {
    model: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    temperature: 0.6,
    top_p: 0.95,
    max_tokens: 65536,
    stream: false,
  }
];
let functionCallingSupported = false;

let model = 0;
const timeout = 10000;
const switchOnTimeout = false;

const openai = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

export async function createCompletion(options: any) {
  let attempts = 0;
  const maxAttempts = switchOnTimeout ? MODEL_SETTINGS.length : 1;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
    //   console.log(options.messages);
      const response = await openai.chat.completions.create({
        ...MODEL_SETTINGS[model],
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      console.log(response.choices[0]);
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);

      const isTimeout = error.name === 'AbortError' || error.message === 'Timeout';

      if (isTimeout && switchOnTimeout && attempts < maxAttempts) {
        console.log(`API call timed out after ${timeout}ms. Switching model and retrying.`);
        model = (model + 1) % MODEL_SETTINGS.length;
        continue;
      }

      if (isTimeout) {
        throw new Error('Timeout');
      }

      throw error;
    }
  }
}

async function handleToolCalling(response: OpenAI.Chat.Completions.ChatCompletion, context: any[]) {
  const message = response.choices[0].message;

  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolResults = await handleToolCalls(message.tool_calls, context);
    const followUpResponse = await createCompletion({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...context,
        message,
        ...toolResults
      ]
    });
    return followUpResponse?.choices[0]?.message?.content?.trim() || '';
  }

  const responseText = message.content?.trim() || '';
  const { hasTool, toolCall } = parseMakeshiftToolCall(responseText);

  if (hasTool && toolCall) {
    const toolResults = await handleToolCalls([toolCall], context);
    const followUpResponse = await createCompletion({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...context,
        { role: 'assistant', content: responseText },
        ...toolResults
      ]
    });
    return followUpResponse?.choices[0]?.message?.content?.trim() || '';
  }

  return responseText;
}

export async function respond(context: any[]) {
  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...context,
    ];

    if (functionCallingSupported) {
      try {
        const response = await createCompletion({
          messages,
          tools: tools,
          tool_choice: "auto"
        });
        if (response) {
          return await handleToolCalling(response, context);
        }
      } catch (error: any) {
        if (error.message === 'Timeout') throw error;
        console.log("Function calling not supported, switching to fallback:", error);
        functionCallingSupported = false;
      }
    }

    const response = await createCompletion({ messages });
    if (response) {
      return await handleToolCalling(response, context);
    }
    return '';
  } catch (error: any) {
    if (error.message === 'Timeout') {
      return 'The AI has timed out.';
    }
    throw error;
  }
}

export function sanitizeContent(text: string): string {
  if (!text) return '';
  return text.replace(/<think>[\s\S]*?(<\/think>|<\\think>)/gi, '').replace(/<NULL>\s*$/gi, '').trim();
}