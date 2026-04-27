import type { LlmProviderName } from '../../config.js';
import type { JsonCompletionRequest, LlmProviderClient } from '../types.js';

const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

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
    const body: Record<string, any> = {
      model: request.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 4096,
      stream: true, // Enable streaming
    };

    // Only add json mode for the native OpenAI API
    if (this.name === 'openai') {
      body.response_format = { type: 'json_object' };
    }

    // AbortController for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${this.name}] HTTP ${response.status} response:`, errorText.substring(0, 800));
        throw new Error(`${this.name} request failed (${response.status}): ${errorText.substring(0, 600)}`);
      }

      if (!response.body) {
        throw new Error(`${this.name} returned no response body for streaming.`);
      }

      // Stream SSE chunks and accumulate content
      const result = await this.readStream(response.body);

      if (result.content.trim()) {
        return result.content;
      }

      // Fallback: check reasoning_content for reasoning models (DeepSeek, GLM)
      if (result.reasoningContent.trim()) {
        const jsonMatch = result.reasoningContent.match(/\{[\s\S]*"intent"[\s\S]*\}/);
        if (jsonMatch) {
          console.log(`[${this.name}] Extracted JSON from streamed reasoning_content`);
          return jsonMatch[0];
        }
      }

      throw new Error(`${this.name} streaming returned empty content.`);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error(`${this.name} request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Read an SSE stream from an OpenAI-compatible API.
   * Accumulates content and reasoning_content from delta chunks.
   */
  private async readStream(body: ReadableStream<Uint8Array>): Promise<{ content: string; reasoningContent: string }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let content = '';
    let reasoningContent = '';
    let buffer = '';
    let chunkCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed === '' || trimmed.startsWith(':')) continue; // Skip empty lines and comments

          if (trimmed === 'data: [DONE]') {
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6); // Remove 'data: ' prefix
            try {
              const chunk = JSON.parse(jsonStr);
              const delta = chunk?.choices?.[0]?.delta;

              if (delta?.content) {
                content += delta.content;
                chunkCount++;
              }
              if (delta?.reasoning_content) {
                reasoningContent += delta.reasoning_content;
              }
            } catch {
              // Skip malformed JSON chunks — this can happen with partial data
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const chunk = JSON.parse(trimmed.slice(6));
            const delta = chunk?.choices?.[0]?.delta;
            if (delta?.content) content += delta.content;
            if (delta?.reasoning_content) reasoningContent += delta.reasoning_content;
          } catch {
            // Skip
          }
        }
      }

      console.log(`[${this.name}] Streamed ${chunkCount} chunks, ${content.length} chars`);
      return { content, reasoningContent };

    } finally {
      reader.releaseLock();
    }
  }
}
