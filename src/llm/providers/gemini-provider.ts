import { parseJsonResponse } from '../http.js';
import type { JsonCompletionRequest, LlmProviderClient } from '../types.js';

export class GeminiProvider implements LlmProviderClient {
  readonly name = 'gemini' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; baseUrl: string }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async completeJson(request: JsonCompletionRequest): Promise<string> {
    const endpoint =
      `${this.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent` +
      `?key=${encodeURIComponent(this.apiKey)}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: request.systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: request.userPrompt }],
          },
        ],
        generationConfig: {
          temperature: request.temperature ?? 0.1,
          maxOutputTokens: request.maxTokens ?? 400,
          responseMimeType: 'application/json',
        },
      }),
    });

    const payload = await parseJsonResponse(response, this.name);
    const parts = payload?.candidates?.[0]?.content?.parts;

    if (!Array.isArray(parts)) {
      throw new Error('gemini returned an unexpected response format.');
    }

    const text = parts
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();

    if (!text) {
      throw new Error('gemini returned empty text content.');
    }

    return text;
  }
}
