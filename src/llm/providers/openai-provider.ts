import type { LlmProviderName } from '../../config.js';
import { parseJsonResponse } from '../http.js';
import type { JsonCompletionRequest, LlmProviderClient } from '../types.js';

export class OpenAIProvider implements LlmProviderClient {
  readonly name: LlmProviderName;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: { name: LlmProviderName; apiKey: string; baseUrl: string }) {
    this.name = options.name;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async completeJson(request: JsonCompletionRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 400,
        response_format: { type: 'json_object' },
      }),
    });

    const payload = await parseJsonResponse(response, this.name);
    const content = payload?.choices?.[0]?.message?.content;

    if (typeof content === 'string' && content.trim()) {
      return content;
    }

    if (Array.isArray(content)) {
      const combined = content
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('');
      if (combined.trim()) return combined;
    }

    throw new Error(`${this.name} returned an empty completion payload.`);
  }
}
