import { Client } from 'discord.js-selfbot-v13';
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { tools, handleToolCalls, parseMakeshiftToolCall, toolsDescription } from './mcp/index';

const TOOLS_PROMPT = `You have access to the following tools:\n${toolsDescription}\n\n` + readFileSync('./prompts/tools.txt', 'utf-8');
const SYSTEM_PROMPT = `${readFileSync('./prompts/prompt.txt', 'utf-8')}\n\n${readFileSync('./prompts/format.txt', 'utf-8')}\n\n${TOOLS_PROMPT}`;

// console.log(SYSTEM_PROMPT);

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

const client = new Client();
const openai = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

client.once('ready', async () => {
  if (client.user) {
    await client.user.setPresence({ status: 'online' });
    console.log(`${client.user.username} is ready!`);
  }
});

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string = 'Request timed out'): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const result = await promise;
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(timeoutMessage);
    }
    throw error;
  }
}

async function callWithRetry(callFn: () => Promise<any>, options: { 
  retryOnTimeout: boolean,
  switchModel?: boolean 
}): Promise<any> {
  try {
    return await withTimeout(callFn(), timeout, 'Timeout');
  } catch (error: any) {
    if (error.message === 'Timeout' && options.retryOnTimeout) {
      console.log(`API call timed out after ${timeout}ms. ${options.switchModel ? 'Switching model and retrying.' : 'Retrying.'}`);
      
      if (options.switchModel) {
        model = 1 - model;
      }
      
      return await callFn();
    }
    throw error;
  }
}

async function createCompletion(options: any) {
  const doRequest = () => openai.chat.completions.create({
    ...MODEL_SETTINGS[model],
    ...options,
  });

  return callWithRetry(doRequest, { 
    retryOnTimeout: switchOnTimeout, 
    switchModel: switchOnTimeout 
  });
}

async function respond(conversation: any[]) {
  try {
    if (functionCallingSupported) {
      try {
        const response = await createCompletion({
          messages: [
            ...conversation,
            { role: 'system', content: SYSTEM_PROMPT + "\n\n" + TOOLS_PROMPT }
          ],
          tools: tools,
          tool_choice: "auto"
        });

        if (response.choices[0]?.message?.tool_calls?.length > 0) {
          const toolResults = await handleToolCalls(response.choices[0].message.tool_calls);
          const followUpResponse = await createCompletion({
            messages: [
              ...conversation,
              { role: 'system', content: SYSTEM_PROMPT + "\n\n" + TOOLS_PROMPT },
              response.choices[0].message,
              ...toolResults
            ]
          });

          return followUpResponse.choices[0]?.message.content.trim();
        } else {
          return response.choices[0]?.message.content.trim();
        }
      } catch (functionError: any) {
        if (functionError.message === 'Timeout') {
          throw functionError;
        }
        console.log("Function calling not supported, switching to fallback:", functionError);
        functionCallingSupported = false;
      }
    }

    const response = await createCompletion({
      messages: [
        ...conversation,
        { role: 'system', content: SYSTEM_PROMPT + "\n\n" + TOOLS_PROMPT }
      ]
    });

    const responseText = response.choices?.[0]?.message.content.trim() || '';

    const { hasTool, toolCall } = parseMakeshiftToolCall(responseText);
    if (hasTool) {
      // console.log("Detected makeshift tool call:", toolCall);
      const toolResults = await handleToolCalls([toolCall]);

      const followUpResponse = await createCompletion({
        messages: [
          ...conversation,
          { role: 'system', content: SYSTEM_PROMPT + "\n\n" + TOOLS_PROMPT },
          { role: 'assistant', content: responseText },
          ...toolResults
        ]
      });

      return followUpResponse.choices[0]?.message.content.trim();
    } else {
      return responseText;
    }
  } catch (error: any) {
    if (error.message === 'Timeout') {
      return 'The AI has timed out.';
    }
    throw error;
  }
}

function sanitizeContent(text: string): string {
  if (!text) return '';
  return text.replace(/<think>[\s\S]*?(<\/think>|<\\think>)/gi, '').trim();
}

client.on('messageCreate', async (message: any) => {
  if (!client.user || (process.env.CHANNEL && message.channel.id !== process.env.CHANNEL)) return;
  console.log(`${message.member?.displayName || message.author.username}: ${message.content}`);

  if (message.author.id === client.user.id) return;

  try {
    const recentMessages = await message.channel.messages.fetch({ limit: 16 });
    const conversation = recentMessages
      .map(msg => msg.content && ({
        role: msg.author.id === client.user.id ? 'assistant' : 'user',
        content: `<user: ${msg.author.displayName}, channel_type: ${message.channel.type}>: ${msg.content}`,
      }))
      .filter(Boolean)
      .reverse();

    const reply = await respond(conversation);
    if (reply && reply.trim() !== '<NULL>') {
      const cleanedReply = sanitizeContent(reply);
      await message.channel.send(cleanedReply);
    }
  } catch (err) {
    console.error('Error getting AI response:', err);
  }
});

client.login(process.env.AUTH_TOKEN);