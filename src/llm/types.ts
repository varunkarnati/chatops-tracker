import type { LlmProviderName } from '../config.js';

export interface JsonCompletionRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmProviderClient {
  readonly name: LlmProviderName;
  completeJson(request: JsonCompletionRequest): Promise<string>;
}
