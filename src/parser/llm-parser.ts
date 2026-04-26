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

Your job: classify each message and extract structured task data.

RULES:
1. Be CONSERVATIVE. Only classify as a task-related intent if the message clearly indicates work to be done.
2. Casual conversation, greetings, jokes, reactions -> GENERAL_CHAT.
3. If someone mentions doing something or asks someone to do something -> likely a task.
4. If someone says something is "done", "completed", or "finished" -> UPDATE_STATUS.
5. Extract deadlines from natural language ("by Friday", "tomorrow", "next week").
6. @mentions indicate task assignment.
7. Respond with valid JSON only, no markdown.

Respond with this exact JSON shape:
{
  "intent": "CREATE_TASK" | "UPDATE_STATUS" | "ASSIGN_TASK" | "SET_DEADLINE" | "QUERY_STATUS" | "ADD_COMMENT" | "SET_PRIORITY" | "BLOCK_TASK" | "EDIT_TASK" | "DELETE_TASK" | "GENERAL_CHAT",
  "task": {
    "title": "short task title",
    "assigneePhone": "mentioned phone or null",
    "deadline": "ISO-8601 date string or natural language",
    "status": "todo|in_progress|review|done|blocked or null",
    "priority": "low|medium|high|critical or null",
    "relatedTaskId": "task number or null",
    "blockReason": "reason or null",
    "editField": "title|desc|priority|deadline|status or null",
    "editValue": "new value for edit or null"
  },
  "confidence": 0.0 to 1.0
}

Today's date: ${new Date().toISOString().split('T')[0]}`;

  try {
    const llm = getProvider();
    const raw = await llm.completeJson({
      model: config.llmModel,
      systemPrompt: systemPromptOverride || defaultSystemPrompt,
      userPrompt: `Sender: ${senderName}\nMentions: ${mentions.join(', ') || 'none'}\nMessage: "${text}"`,
      temperature: 0.1,
      maxTokens: 400,
    });

    const parsed = JSON.parse(extractJsonPayload(raw));
    return normalizeParsedIntent(parsed);
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
  const intent: ParsedIntent['intent'] = ALLOWED_INTENTS.has(raw?.intent) ? raw.intent : 'GENERAL_CHAT';
  const confidence = normalizeConfidence(raw?.confidence);

  const task = normalizeTask(raw?.task);
  return {
    intent,
    task: task && Object.keys(task).length > 0 ? task : undefined,
    confidence,
  };
}

function normalizeTask(raw: any): ParsedIntent['task'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const task: NonNullable<ParsedIntent['task']> = {};

  if (typeof raw.title === 'string' && raw.title.trim()) {
    task.title = raw.title.trim();
  }
  if (typeof raw.assigneePhone === 'string' && raw.assigneePhone.trim()) {
    task.assigneePhone = raw.assigneePhone.trim();
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
