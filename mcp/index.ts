import type { ChatCompletionTool } from 'openai/resources';
import type { Tool } from './types';

import Weather from './tools/weather';
import ImageGen from './tools/image-gen';
// import Api from './tools/api';
import { discordReply, discordReact } from './tools/discord';

export const tools: Tool[] = [
    Weather,
    ImageGen,
    // Api,
    discordReply,
    discordReact
];

export const chatCompletionTools: ChatCompletionTool[] = tools.map(({ name, description, parameters }) => ({
  type: "function",
  function: { name, description, parameters },
}));

const toolMap = new Map(tools.map(tool => [tool.name, tool]));

export const toolsDescription = tools.map(tool => {
  const parameters = Object.entries(tool.parameters?.properties || {})
    .map(([key, value]: [string, any]) => {
      const type = value.type;
      const required = Array.isArray(tool.parameters?.required) ? tool.parameters.required : [];
      const optional = !required.includes(key);
      const defaultValue = value.default ? '' : ` = ${JSON.stringify(value.default)}`;
      const optionalMark = optional ? '?' : '';
      return `${key}${optionalMark}: ${type}${defaultValue}`;
    })
    .join(', ');

  return `${tool.name}(${parameters}): ${tool.description}`;
}).join('\n');

export async function handleToolCalls(toolCalls: any[], messages: any[], context?: any) {
  return Promise.all(toolCalls.map(async (toolCall) => {
    const { name, arguments: argsString } = toolCall.function;
    const args = JSON.parse(argsString);
    const tool = toolMap.get(name);
    
    let content;
    try {
      content = tool 
        ? await tool.handler(args, messages.at(-1).content, context)
        : `No handler implemented for tool: ${name}`;
    } catch (error) {
      content = `Error executing tool ${name}: ${error}`;
    }

    return {
      tool_call_id: toolCall.id,
      role: "tool",
      name,
      content,
    };
  }));
}

export function parseMakeshiftToolCall(text: string): { hasTool: boolean; toolCall: any | null } {
  const startIndex = text.indexOf('{');
  const endIndex = text.lastIndexOf('}');

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return { hasTool: false, toolCall: null };
  }

  const potentialJson = text.substring(startIndex, endIndex + 1);

  try {
    const parsed = JSON.parse(potentialJson);

    if (parsed.tool && typeof parsed.tool === 'string' && parsed.args && typeof parsed.args === 'object') {
      const toolCall = {
        id: `makeshift-${Date.now()}`,
        type: 'function',
        function: {
          name: parsed.tool,
          arguments: JSON.stringify(parsed.args),
        },
      };
      console.log(`Found and parsed makeshift tool call: ${parsed.tool}`);
      return { hasTool: true, toolCall: toolCall };
    }
  } catch (error) {
    return { hasTool: false, toolCall: null };
  }

  return { hasTool: false, toolCall: null };
}