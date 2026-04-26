import 'dotenv/config';

export type LlmProviderName = 'openai' | 'anthropic' | 'gemini' | 'openai_compatible';

const DEFAULT_LLM_PROVIDER: LlmProviderName = 'openai';

function parseLlmProvider(value: string | undefined): LlmProviderName {
  if (!value) return DEFAULT_LLM_PROVIDER;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'openai' ||
    normalized === 'anthropic' ||
    normalized === 'gemini' ||
    normalized === 'openai_compatible'
  ) {
    return normalized;
  }
  return DEFAULT_LLM_PROVIDER;
}

export interface AppConfig {
  llmProvider: LlmProviderName;
  llmModel: string;
  llmBaseUrl: string;
  llmApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  botName: string;
  commandPrefix: string;
  confidenceThreshold: number;
  allowedGroups: string[];
  dbPath: string;
  sessionPath: string;
  workspacePath: string;
  jwtSecret: string;
  dashboardPort: number;
}

export const config: AppConfig = {
  llmProvider: parseLlmProvider(process.env.LLM_PROVIDER),
  llmModel: process.env.LLM_MODEL || 'gpt-4o-mini',
  llmBaseUrl: process.env.LLM_BASE_URL || '',
  llmApiKey: process.env.LLM_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  botName: process.env.BOT_NAME || 'TaskBot',
  commandPrefix: process.env.COMMAND_PREFIX || '!',
  confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.7'),
  allowedGroups: (process.env.ALLOWED_GROUPS || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean),
  dbPath: './data/tracker.db',
  sessionPath: './data/wa-session',
  workspacePath: './workspace',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3001'),
};
