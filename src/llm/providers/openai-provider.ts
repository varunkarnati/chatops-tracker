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
    // Build request body — only include response_format for native OpenAI
    // Many OpenAI-compatible APIs (NVIDIA, Groq, etc.) don't support it
    const body: Record<string, any> = {
      model: request.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 4096,
    };

    // Only add json mode for the native OpenAI API
    if (this.name === 'openai') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = await parseJsonResponse(response, this.name);

    // Handle standard OpenAI response shape
    const choice = payload?.choices?.[0];
    if (!choice) {
      console.error(`[${this.name}] No choices in response:`, JSON.stringify(payload).substring(0, 500));
      throw new Error(`${this.name} returned no choices in response.`);
    }

    const message = choice.message || choice.delta;
    let content = message?.content;

    // Handle string content (most common)
    if (typeof content === 'string' && content.trim()) {
      return content;
    }

    // Handle array content (some providers return parts)
    if (Array.isArray(content)) {
      const combined = content
        .map((part: any) => (typeof part?.text === 'string' ? part.text : typeof part === 'string' ? part : ''))
        .join('');
      if (combined.trim()) return combined;
    }

    // Reasoning models (DeepSeek, GLM, etc.) put thinking in reasoning_content
    // and the actual answer in content. If content is empty but reasoning has
    // JSON embedded in it, try to extract the JSON from reasoning_content.
    const reasoning = message?.reasoning_content;
    if (typeof reasoning === 'string' && reasoning.trim()) {
      const jsonMatch = reasoning.match(/\{[\s\S]*"intent"[\s\S]*\}/);
      if (jsonMatch) {
        console.log(`[${this.name}] Extracted JSON from reasoning_content`);
        return jsonMatch[0];
      }
    }

    // Try the full message text field as fallback
    if (typeof message?.text === 'string' && message.text.trim()) {
      return message.text;
    }

    const finishReason = choice.finish_reason || choice.finishReason;
    console.error(`[${this.name}] Empty content. finish_reason: ${finishReason}, message:`, JSON.stringify(message).substring(0, 500));

    throw new Error(`${this.name} returned an empty completion payload (finish_reason: ${finishReason}).`);
  }
}
