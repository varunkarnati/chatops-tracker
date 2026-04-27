import type { JsonCompletionRequest, LlmProviderClient } from '../types.js';

const REQUEST_TIMEOUT_MS = 30_000;

export class AnthropicProvider implements LlmProviderClient {
  readonly name = 'anthropic' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; baseUrl: string }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async completeJson(request: JsonCompletionRequest): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
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
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[anthropic] HTTP ${response.status}:`, errorText.substring(0, 800));
        throw new Error(`anthropic request failed (${response.status}): ${errorText.substring(0, 600)}`);
      }

      if (!response.body) {
        throw new Error('anthropic returned no response body for streaming.');
      }

      return await this.readStream(response.body);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error(`anthropic request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Read Anthropic SSE stream. Events:
   *   content_block_delta → { delta: { text: "..." } }
   *   message_stop → end of stream
   */
  private async readStream(body: ReadableStream<Uint8Array>): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let content = '';
    let buffer = '';
    let chunkCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6);
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'content_block_delta' && event.delta?.text) {
              content += event.delta.text;
              chunkCount++;
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }

      console.log(`[anthropic] Streamed ${chunkCount} chunks, ${content.length} chars`);

      if (!content.trim()) {
        throw new Error('anthropic streaming returned empty text content.');
      }

      return content;
    } finally {
      reader.releaseLock();
    }
  }
}
