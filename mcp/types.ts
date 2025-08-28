import type { FunctionDefinition } from 'openai/resources';

export interface Tool {
  name: string;
  description: string;
  parameters: FunctionDefinition['parameters'];
  handler: (args: Record<string, any>, message?: any) => Promise<string>;
}
