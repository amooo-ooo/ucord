import type { ChatCompletionTool } from 'openai/resources';
import type { Tool } from './types';

import Weather from './tools/weather';
import ImageGen from './tools/image-gen';

export const tools: Tool[] = [
    Weather,
    ImageGen
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

export async function handleToolCalls(toolCalls: any[], message?: any) {
  return Promise.all(toolCalls.map(async (toolCall) => {
    const { name, arguments: argsString } = toolCall.function;
    const args = JSON.parse(argsString);
    const tool = toolMap.get(name);
    
    let content;
    try {
      content = tool 
        ? await tool.handler(args, message)
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

export function parseMakeshiftToolCall(text: string) {
  try {
    const data = JSON.parse(text.trim());
    if (data && typeof data.tool === 'string' && typeof data.args === 'object') {
      return {
        hasTool: true,
        toolCall: {
          id: `makeshift-${Date.now()}`,
          function: {
            name: data.tool,
            arguments: JSON.stringify(data.args)
          }
        },
        processedText: `[Using tool: ${data.tool}]`
      };
    }
  } catch {
    // Ignore invalid JSON
  }
  return { hasTool: false, toolCall: undefined, processedText: text };
}
