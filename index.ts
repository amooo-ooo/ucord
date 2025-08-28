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

async function createCompletion(options: any) {
  let attempts = 0;
  const maxAttempts = switchOnTimeout ? MODEL_SETTINGS.length : 1;
  
  while (attempts < maxAttempts) {
    attempts++;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      console.log(options.messages);
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

async function handleToolCalling(response: OpenAI.Chat.Completions.ChatCompletion, conversation: any[], originalMessage: any) {
  const message = response.choices[0].message;

  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolResults = await handleToolCalls(message.tool_calls, originalMessage);
    const followUpResponse = await createCompletion({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...conversation,
        message,
        ...toolResults
      ]
    });
    return followUpResponse?.choices[0]?.message?.content?.trim() || '';
  }

  const responseText = message.content?.trim() || '';
  const { hasTool, toolCall } = parseMakeshiftToolCall(responseText);

  if (hasTool && toolCall) {
    const toolResults = await handleToolCalls([toolCall], originalMessage);
    const followUpResponse = await createCompletion({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...conversation,
        { role: 'assistant', content: responseText },
        ...toolResults
      ]
    });
    return followUpResponse?.choices[0]?.message?.content?.trim() || '';
  }

  return responseText;
}

async function respond(conversation: any[]) {
  try {
    const originalMessage = conversation.find(msg => msg.originalMessage)?.originalMessage;
    
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversation,
    ];

    if (functionCallingSupported) {
      try {
        const response = await createCompletion({
          messages,
          tools: tools,
          tool_choice: "auto"
        });
        if (response) {
          return await handleToolCalling(response, conversation, originalMessage);
        }
      } catch (error: any) {
        if (error.message === 'Timeout') throw error;
        console.log("Function calling not supported, switching to fallback:", error);
        functionCallingSupported = false;
      }
    }

    const response = await createCompletion({ messages });
    if (response) {
      return await handleToolCalling(response, conversation, originalMessage);
    }
    return '';
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
      .filter((msg: any) => msg.content)
      .map((msg: any) => {
        const isAssistant = msg.author.id === client.user?.id;
        const content = isAssistant 
          ? msg.content 
          : `<user: ${msg.author.displayName || msg.author.username}, channel_type: ${message.channel.type}>: ${msg.content}`;
        
        const messageObj: any = {
          role: isAssistant ? 'assistant' : 'user',
          content: content,
        };
        
        if (msg.id === message.id) {
          messageObj.originalMessage = message;
        }
        
        return messageObj;
      })
      .filter(Boolean)
      .reverse();
      
    message.channel.sendTyping();
    const reply = await respond(conversation);
    if (reply && reply.trim().toLowerCase() !== '<null>') {
      const cleanedReply = sanitizeContent(reply);
      await message.channel.send(cleanedReply);
    }
  } catch (err) {
    console.error('Error getting AI response:', err);
  }
});

client.login(process.env.AUTH_TOKEN);
