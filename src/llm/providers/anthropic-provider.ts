import { parseJsonResponse } from '../http.js';
import type { JsonCompletionRequest, LlmProviderClient } from '../types.js';

export class AnthropicProvider implements LlmProviderClient {
  readonly name = 'anthropic' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; baseUrl: string }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async completeJson(request: JsonCompletionRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userPrompt }],
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 400,
      }),
    });

    const payload = await parseJsonResponse(response, this.name);
    const content = payload?.content;

    if (!Array.isArray(content)) {
      throw new Error('anthropic returned an unexpected response format.');
    }

    const text = content
      .map((block: any) => (block?.type === 'text' && typeof block?.text === 'string' ? block.text : ''))
      .join('')
      .trim();

    if (!text) {
      throw new Error('anthropic returned empty text content.');
    }

    return text;
  }
}
