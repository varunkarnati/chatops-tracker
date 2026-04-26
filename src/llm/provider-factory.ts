import type { AppConfig } from '../config.js';
import type { LlmProviderClient } from './types.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { GeminiProvider } from './providers/gemini-provider.js';
import { OpenAIProvider } from './providers/openai-provider.js';

export function createLlmProvider(config: AppConfig): LlmProviderClient {
  switch (config.llmProvider) {
    case 'openai': {
      const apiKey = requireValue(config.openaiApiKey || config.llmApiKey, 'OPENAI_API_KEY');
      const baseUrl = config.llmBaseUrl || 'https://api.openai.com/v1';
      return new OpenAIProvider({ name: 'openai', apiKey, baseUrl });
    }
    case 'openai_compatible': {
      const apiKey = requireValue(config.llmApiKey || config.openaiApiKey, 'LLM_API_KEY');
      const baseUrl = config.llmBaseUrl || 'https://api.openai.com/v1';
      return new OpenAIProvider({ name: 'openai_compatible', apiKey, baseUrl });
    }
    case 'anthropic': {
      const apiKey = requireValue(config.anthropicApiKey, 'ANTHROPIC_API_KEY');
      const baseUrl = config.llmBaseUrl || 'https://api.anthropic.com/v1';
      return new AnthropicProvider({ apiKey, baseUrl });
    }
    case 'gemini': {
      const apiKey = requireValue(config.geminiApiKey, 'GEMINI_API_KEY');
      const baseUrl = config.llmBaseUrl || 'https://generativelanguage.googleapis.com/v1beta';
      return new GeminiProvider({ apiKey, baseUrl });
    }
    default:
      return assertNever(config.llmProvider);
  }
}

function requireValue(value: string, envName: string): string {
  if (!value.trim()) {
    throw new Error(`Missing required environment variable for selected provider: ${envName}`);
  }
  return value.trim();
}

function assertNever(value: never): never {
  throw new Error(`Unsupported LLM provider: ${String(value)}`);
}
