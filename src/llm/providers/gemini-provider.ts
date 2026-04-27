import type { JsonCompletionRequest, LlmProviderClient } from '../types.js';

const REQUEST_TIMEOUT_MS = 30_000;

export class GeminiProvider implements LlmProviderClient {
  readonly name = 'gemini' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; baseUrl: string }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async completeJson(request: JsonCompletionRequest): Promise<string> {
    // Gemini uses streamGenerateContent for streaming
    const endpoint =
      `${this.baseUrl}/models/${encodeURIComponent(request.model)}:streamGenerateContent` +
      `?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
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
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[gemini] HTTP ${response.status}:`, errorText.substring(0, 800));
        throw new Error(`gemini request failed (${response.status}): ${errorText.substring(0, 600)}`);
      }

      if (!response.body) {
        throw new Error('gemini returned no response body for streaming.');
      }

      return await this.readStream(response.body);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error(`gemini request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Read Gemini SSE stream. Each data chunk contains:
   * { candidates: [{ content: { parts: [{ text: "..." }] } }] }
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
            const chunk = JSON.parse(jsonStr);
            const parts = chunk?.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (typeof part?.text === 'string') {
                  content += part.text;
                  chunkCount++;
                }
              }
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }

      console.log(`[gemini] Streamed ${chunkCount} chunks, ${content.length} chars`);

      if (!content.trim()) {
        throw new Error('gemini streaming returned empty text content.');
      }

      return content;
    } finally {
      reader.releaseLock();
    }
  }
}
