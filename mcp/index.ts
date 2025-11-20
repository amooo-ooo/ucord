import type { Tool } from './types';
import { XMLParser } from 'fast-xml-parser';
import ImageGen from './tools/image-gen';
import { discordReply, discordReact } from './tools/discord';
import { searchGifs } from './tools/tenor';
// import { webSearch } from './tools/web';
import { weather } from './tools/weather';

export const tools: Tool[] = [
  ImageGen,
  searchGifs,
  // webSearch,
  discordReply,
  discordReact,
  weather
];

const toolMap = new Map(tools.map(tool => [tool.name, tool]));

export const toolsDescription = tools.map(tool => {
  const parameters = Object.entries(tool.parameters?.properties || {})
    .map(([key, value]: [string, any]) => {
      const type = value.type;
      const required = Array.isArray(tool.parameters?.required) ? tool.parameters.required : [];
      const optional = !required.includes(key);
      const defaultValue = value.default ? ` = ${JSON.stringify(value.default)}` : '';
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

function parseAttributeValue(value: string): any {
  const trimmedValue = value.trim();

  if ((trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) || (trimmedValue.startsWith('{') && trimmedValue.endsWith('}'))) {
    try {
      return JSON.parse(trimmedValue);
    } catch (e) {
      try {
        const jsonFriendlyString = trimmedValue.replace(/'/g, '"');
        return JSON.parse(jsonFriendlyString);
      } catch (e2) {
        // Fall through
      }
    }
  }

  if (trimmedValue.toLowerCase() === 'true') return true;
  if (trimmedValue.toLowerCase() === 'false') return false;

  if (trimmedValue !== '' && !isNaN(Number(trimmedValue))) {
    if (trimmedValue.length > 15) {
      return trimmedValue;
    }
    return Number(trimmedValue);
  }
  return value;
}


const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
  parseAttributeValue: false,
});

const toolTagRegex = /<([a-zA-Z0-9_]+)((?:\s+\w+=(?:"[^"]*"|'[^']*'))*)\s*\/>/g;

export function parseMakeshiftToolCalls(text: string): { hasTools: boolean; toolCalls: any[] | null; leftoverText: string } {
  const toolCalls: any[] = [];
  const matches = [...text.matchAll(toolTagRegex)];
  const leftoverText = text.replace(toolTagRegex, '').trim();

  if (matches.length === 0) {
    return { hasTools: false, toolCalls: null, leftoverText };
  }

  for (const match of matches) {
    const toolString = match[0];
    try {
      const parsed = parser.parse(toolString);
      let toolName = Object.keys(parsed)[0];
      const attributes = parsed[toolName] || {};

      if (toolName === 'tool' && attributes.name) {
        toolName = attributes.name;
        delete attributes.name;
      }

      const args: { [key: string]: any } = {};
      for (const key in attributes) {
        if (Object.prototype.hasOwnProperty.call(attributes, key)) {
          args[key] = parseAttributeValue(attributes[key]);
        }
      }

      const toolCall = {
        id: `makeshift-${Date.now()}-${toolCalls.length}`,
        type: 'function',
        function: {
          name: toolName,
          arguments: JSON.stringify(args),
        },
      };
      toolCalls.push(toolCall);
    } catch (error) {
      console.error(`Failed to parse a tool tag: "${toolString}"`, error);
      continue;
    }
  }

  if (toolCalls.length > 0) {
    console.log(`Found and parsed ${toolCalls.length} makeshift tool call(s).`);
    return { hasTools: true, toolCalls, leftoverText };
  }

  return { hasTools: false, toolCalls: null, leftoverText };
}