import type { FunctionDefinition } from 'openai/resources';

export interface Tool {
  name: string;
  description: string;
  parameters: FunctionDefinition['parameters'];
  handler: (args: Record<string, any>) => Promise<string>;
}