import { config } from '../config.js';
import { createLlmProvider } from '../llm/provider-factory.js';
import type { LlmProviderClient } from '../llm/types.js';
import { ParsedIntent, TaskPriority, TaskStatus } from '../tasks/models.js';

const SKIP_PATTERNS = [
  /^[\p{Emoji}\s]+$/u,
  /^(ok|okay|lol|haha|hmm|nice|cool|thanks|ty|gm|good morning|gn|good night|hi|hello|hey)$/i,
  /^.{0,3}$/,
];

const ALLOWED_INTENTS = new Set<ParsedIntent['intent']>([
  'CREATE_TASK',
  'UPDATE_STATUS',
  'ASSIGN_TASK',
  'SET_DEADLINE',
  'QUERY_STATUS',
  'ADD_COMMENT',
  'SET_PRIORITY',
  'BLOCK_TASK',
  'EDIT_TASK',
  'DELETE_TASK',
  'SHOW_HELP',
  'CREATE_CRON',
  'DELETE_CRON',
  'GENERAL_CHAT',
]);

const ALLOWED_STATUSES = new Set<TaskStatus>(['todo', 'in_progress', 'review', 'done', 'blocked']);
const ALLOWED_PRIORITIES = new Set<TaskPriority>(['low', 'medium', 'high', 'critical']);

let provider: LlmProviderClient | null = null;

export async function parseLLM(
  text: string,
  senderName: string,
  mentions: string[],
  systemPromptOverride?: string
): Promise<ParsedIntent> {
  if (SKIP_PATTERNS.some((p) => p.test(text.trim()))) {
    return { intent: 'GENERAL_CHAT', confidence: 1.0 };
  }

  const defaultSystemPrompt = `You are a task-tracking assistant analyzing WhatsApp group messages for a software team.

Your job: classify each message and extract structured task or cron data.
IMPORTANT: Output ONLY the JSON object. No explanation, no reasoning, no markdown fences.

RULES:
1. One-off work items (e.g. "Fix the login bug", "I'll do the docs") -> CREATE_TASK.
2. Recurring events, scheduled reminders, or messages with a specific frequency (e.g. "Every day at...", "Remind us at 11pm", "Standup at 10am daily") -> CREATE_CRON.
3. If it has a frequency or recurring time, it is ALWAYS a CRON job, NOT a task.
4. For CREATE_CRON, always provide a "schedule" (cron format or natural time) and a "message".

JSON schema:
{
  "intent": "CREATE_TASK|UPDATE_STATUS|ASSIGN_TASK|SET_DEADLINE|QUERY_STATUS|ADD_COMMENT|SET_PRIORITY|BLOCK_TASK|EDIT_TASK|DELETE_TASK|CREATE_CRON|DELETE_CRON|GENERAL_CHAT",
  "task": {
    "title": "string|null",
    "assigneePhone": "use phone from mentions or null",
    "deadline": "string|null"
  },
  "cron": {
    "name": "short name for reminder",
    "schedule": "cron format (e.g. '22 23 * * *' for 11:22 PM) or natural time",
    "message": "message to send when triggered"
  },
  "confidence": 0.0
}

Today: ${new Date().toISOString().split('T')[0]}`;

  try {
    const llm = getProvider();
    const raw = await llm.completeJson({
      model: config.llmModel,
      systemPrompt: systemPromptOverride || defaultSystemPrompt,
      userPrompt: `Sender: ${senderName}\nMentions: ${mentions.join(', ') || 'none'}\nMessage: "${text}"`,
      temperature: 0.1,
      maxTokens: 2048,
    });

    console.log(`🤖 LLM Raw Output:`, raw.substring(0, 500) + (raw.length > 500 ? '...' : ''));

    const parsed = JSON.parse(extractJsonPayload(raw));
    const intent = normalizeParsedIntent(parsed);
    
    console.log(`🎯 Parsed Intent: ${intent.intent} (${(intent.confidence * 100).toFixed(0)}%)`);
    return intent;
  } catch (error) {
    console.error('LLM parsing error:', error);
    return { intent: 'GENERAL_CHAT', confidence: 0 };
  }
}

function getProvider(): LlmProviderClient {
  if (!provider) {
    provider = createLlmProvider(config);
  }
  return provider;
}

function extractJsonPayload(raw: string): string {
  let cleaned = raw.trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

function normalizeParsedIntent(raw: any): ParsedIntent {
  const rawIntent = (raw?.intent || raw?.action || 'GENERAL_CHAT').toUpperCase();
  const intent: ParsedIntent['intent'] = ALLOWED_INTENTS.has(rawIntent as any) ? (rawIntent as any) : 'GENERAL_CHAT';
  
  // Default to 1.0 if confidence is missing but intent is specific
  const confidence = raw?.confidence !== undefined ? normalizeConfidence(raw.confidence) : (intent === 'GENERAL_CHAT' ? 1.0 : 1.0);

  const task = normalizeTask(raw?.task);
  const cron = normalizeCron(raw?.cron);
  
  return {
    intent,
    task: task && Object.keys(task).length > 0 ? task : undefined,
    cron: cron && Object.keys(cron).length > 0 ? cron : undefined,
    confidence,
  };
}

function normalizeCron(raw: any): ParsedIntent['cron'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const cron: NonNullable<ParsedIntent['cron']> = {};
  if (typeof raw.name === 'string') cron.name = raw.name;
  if (typeof raw.schedule === 'string') cron.schedule = raw.schedule;
  if (typeof raw.message === 'string') cron.message = raw.message;
  return cron;
}

function normalizeTask(raw: any): ParsedIntent['task'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const task: NonNullable<ParsedIntent['task']> = {};

  if (typeof raw.title === 'string' && raw.title.trim()) {
    task.title = raw.title.trim();
  }
  
  // Robust assignee lookup
  const assignee = raw.assigneePhone || raw.assignee;
  if (typeof assignee === 'string' && assignee.trim()) {
    task.assigneePhone = assignee.trim();
  }

  if (typeof raw.deadline === 'string' && raw.deadline.trim()) {
    task.deadline = raw.deadline.trim();
  }
  if (typeof raw.blockReason === 'string' && raw.blockReason.trim()) {
    task.blockReason = raw.blockReason.trim();
  }
  if (typeof raw.editField === 'string' && raw.editField.trim()) {
    task.editField = raw.editField.trim();
  }
  if (typeof raw.editValue === 'string' && raw.editValue.trim()) {
    task.editValue = raw.editValue.trim();
  }

  if (typeof raw.status === 'string' && ALLOWED_STATUSES.has(raw.status as TaskStatus)) {
    task.status = raw.status as TaskStatus;
  }
  if (typeof raw.priority === 'string' && ALLOWED_PRIORITIES.has(raw.priority as TaskPriority)) {
    task.priority = raw.priority as TaskPriority;
  }

  const relatedTaskId = normalizeRelatedTaskId(raw.relatedTaskId);
  if (relatedTaskId !== undefined) {
    task.relatedTaskId = relatedTaskId;
  }

  return task;
}

function normalizeRelatedTaskId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function normalizeConfidence(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}
