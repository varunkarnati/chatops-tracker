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
  'EDIT_TASK',
  'DELETE_TASK',
  'SHOW_HELP',
  'CREATE_CRON',
  'DELETE_CRON',
  'DASHBOARD_CHART',
  'EXECUTE_CODE',
  'GENERAL_CHAT',
]);

const ALLOWED_STATUSES = new Set<TaskStatus>(['todo', 'in_progress', 'testing', 'done']);
const ALLOWED_PRIORITIES = new Set<TaskPriority>(['low', 'medium', 'high', 'critical']);

/**
 * Fast-path patterns for recurring/scheduled messages.
 * These bypass the LLM entirely and go straight to CREATE_CRON.
 */
const CRON_FAST_PATTERNS = [
  /every\s+day\b/i,
  /\bdaily\b.*\b(?:remind|standup|report|check|notify|alert|meet|meeting)/i,
  /\b(?:remind|standup|report|check|notify|alert|meet|meeting)\b.*\bdaily\b/i,
  /every\s+(?:morning|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
  /\bweekly\b.*\b(?:remind|report|standup|meet|meeting)/i,
  /\b(?:remind|report|standup|meet|meeting)\b.*\bweekly\b/i,
  /every\s+\d+\s*(?:hour|minute|min)/i,
  /\b(?:remind|notify|alert)\s+(?:us|me|team)\s+(?:at|every)\b/i,
  /\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\s+(?:every|daily|weekly)/i,
  /every\s+day\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i,
];

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

  // --- Fast Fallback (No LLM needed) ---
  const lower = text.toLowerCase();
  if (lower.includes('dashboard') || lower.includes('chart') || lower.includes('visual report')) {
    return { intent: 'DASHBOARD_CHART', confidence: 1.0 };
  }
  if (lower.includes('status') && (lower.includes('all') || lower.includes('project'))) {
    return { intent: 'QUERY_STATUS', confidence: 1.0 };
  }

  // --- Cron Fast-Path: detect recurring schedule requests before calling LLM ---
  const isCronLike = CRON_FAST_PATTERNS.some(p => p.test(text));
  if (isCronLike) {
    // Try to extract time and build a cron schedule
    const cronResult = tryFastCronParse(text);
    if (cronResult) {
      console.log(`⚡ Fast-path CRON detected: schedule=${cronResult.cron?.schedule}`);
      return cronResult;
    }
    // If fast parse fails, fall through to LLM but with cron hint
  }

  const defaultSystemPrompt = `You are a task-tracking assistant analyzing WhatsApp group messages for a software team.

Your job: classify each message and extract structured task or cron data.
IMPORTANT: Output ONLY the JSON object. No explanation, no reasoning, no markdown fences.

RULES:
1. One-off work items (e.g. "Fix the login bug", "I'll do the docs") -> CREATE_TASK.
2. Recurring events, scheduled reminders, or messages with a specific frequency (e.g. "Every day at...", "Remind us at 11pm", "Standup at 10am daily") -> CREATE_CRON.
3. If it has a frequency or recurring time, it is ALWAYS a CRON job, NOT a task.
4. For CREATE_CRON, always provide a "schedule" in standard 5-field cron format (minute hour day-of-month month day-of-week) and a "message".
5. Examples of cron schedules: "0 9 * * *" = every day at 9 AM, "30 23 * * *" = every day at 11:30 PM, "0 10 * * 1-5" = weekdays at 10 AM.
6. When a user replies to a task confirmation message, interpret it as an update to that task, NOT a new task.
7. For UPDATE_STATUS, always include "relatedTaskId" as a number.
8. If the user refers to a task by name (e.g., "move the login task to testing") without the ID, YOU MUST FIND the task in the 'Current Board State' snapshot, extract its #ID, and output it as "relatedTaskId".
9. For EXECUTE_CODE, the code snippet MUST be a valid JSON string. You MUST escape all newlines as \\n, double quotes as \\", and backslashes as \\\\.
10. For UPDATE_STATUS, you MUST provide the "status" field in the task object (one of: "todo", "in_progress", "testing", "done"). Do not leave it empty.

JSON schema:
{
  "intent": "CREATE_TASK|UPDATE_STATUS|ASSIGN_TASK|SET_DEADLINE|QUERY_STATUS|ADD_COMMENT|SET_PRIORITY|EDIT_TASK|DELETE_TASK|CREATE_CRON|DELETE_CRON|EXECUTE_CODE|GENERAL_CHAT",
  "task": {
    "title": "string|null",
    "assigneePhone": "use phone from mentions or null",
    "deadline": "string|null",
    "status": "todo|in_progress|testing|done",
    "relatedTaskId": "number|null",
    "priority": "low|medium|high|critical"
  },
  "cron": {
    "name": "short name for reminder",
    "schedule": "5-field cron format ONLY (e.g. '0 22 * * *' for 10 PM daily)",
    "message": "message to send when triggered"
  },
  "code": {
    "language": "python|javascript|bash",
    "snippet": "properly escaped code string here"
  },
  "confidence": 0.0
}

Today: ${new Date().toISOString().split('T')[0]}`;

  try {
    const llm = getProvider();

    // Add cron hint to user prompt if we detected a cron-like pattern
    let userPrompt = `Sender: ${senderName}\nMentions: ${mentions.join(', ') || 'none'}\nMessage: "${text}"`;
    if (isCronLike) {
      userPrompt += `\n\nHINT: This message appears to describe a RECURRING schedule. Classify as CREATE_CRON with a valid 5-field cron schedule.`;
    }

    const raw = await llm.completeJson({
      model: config.llmModel,
      systemPrompt: systemPromptOverride || defaultSystemPrompt,
      userPrompt,
      temperature: 0.1,
      maxTokens: 2048,
    });

    console.log(`🤖 LLM Raw Output:`, raw.substring(0, 500) + (raw.length > 500 ? '...' : ''));

    let jsonStr = extractJsonPayload(raw);
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.warn('⚠️ JSON parse failed, attempting strict regex fallback extraction for code snippet');
      // If parsing fails (usually due to unescaped code), fallback to manual extraction
      const intentMatch = jsonStr.match(/"intent"\s*:\s*"([^"]+)"/);
      const langMatch = jsonStr.match(/"language"\s*:\s*"([^"]+)"/);
      // Extract everything between "snippet": " and the final "
      const snippetMatch = jsonStr.match(/"snippet"\s*:\s*"([\s\S]*?)"\s*\}/);
      
      if (intentMatch && intentMatch[1] === 'EXECUTE_CODE' && snippetMatch) {
        parsed = {
          intent: 'EXECUTE_CODE',
          code: {
            language: langMatch ? langMatch[1] : 'javascript',
            snippet: snippetMatch[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"')
          },
          confidence: 1.0
        };
      } else {
        throw e;
      }
    }
    
    const intent = normalizeParsedIntent(parsed);
    
    console.log(`🎯 Parsed Intent: ${intent.intent} (${(intent.confidence * 100).toFixed(0)}%)`);
    return intent;
  } catch (error) {
    console.error('LLM parsing error:', error);
    return { intent: 'GENERAL_CHAT', confidence: 0 };
  }
}

/**
 * Try to extract time from a natural language recurring schedule.
 * Returns a CREATE_CRON intent with a valid 5-field cron schedule, or null.
 */
function tryFastCronParse(text: string): ParsedIntent | null {
  // Match patterns like "at 11:22 PM", "at 9 AM", "at 23:00"
  const timeMatch = text.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?/i);
  if (!timeMatch) return null;

  let hour = parseInt(timeMatch[1]);
  const minute = parseInt(timeMatch[2] || '0');
  const ampm = timeMatch[3]?.toLowerCase();

  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  // Determine day-of-week
  const lower = text.toLowerCase();
  let dayOfWeek = '* * *'; // default: every day
  if (/\bweekday/i.test(lower) || /\bmon.*fri/i.test(lower)) {
    dayOfWeek = '* * 1-5';
  } else if (/\bweekend/i.test(lower)) {
    dayOfWeek = '* * 0,6';
  } else if (/\bmonday/i.test(lower)) {
    dayOfWeek = '* * 1';
  } else if (/\btuesday/i.test(lower)) {
    dayOfWeek = '* * 2';
  } else if (/\bwednesday/i.test(lower)) {
    dayOfWeek = '* * 3';
  } else if (/\bthursday/i.test(lower)) {
    dayOfWeek = '* * 4';
  } else if (/\bfriday/i.test(lower)) {
    dayOfWeek = '* * 5';
  } else if (/\bsaturday/i.test(lower)) {
    dayOfWeek = '* * 6';
  } else if (/\bsunday/i.test(lower)) {
    dayOfWeek = '* * 0';
  }

  const schedule = `${minute} ${hour} ${dayOfWeek}`;

  // Extract a meaningful name/message from the text
  const cleanedText = text
    .replace(/every\s+day\b/i, '')
    .replace(/\bdaily\b/i, '')
    .replace(/\bweekly\b/i, '')
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i, '')
    .replace(/\bremind\s+(?:us|me|team)\s+(?:to\s+)?/i, '')
    .trim();

  const messageName = cleanedText || 'Scheduled reminder';
  const timeStr = `${hour > 12 ? hour - 12 : hour}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;

  return {
    intent: 'CREATE_CRON',
    cron: {
      name: messageName.length > 50 ? messageName.substring(0, 50) : messageName,
      schedule,
      message: cleanedText || `⏰ Reminder: ${messageName}`,
    },
    confidence: 0.95,
  };
}

function getProvider(): LlmProviderClient {
  if (!provider) {
    provider = createLlmProvider(config);
  }
  return provider;
}

export function extractJsonPayload(raw: string): string {
  // Strip out any reasoning blocks before trying to find the JSON
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

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

export function normalizeParsedIntent(raw: any): ParsedIntent {
  let rawIntent = (raw?.intent || raw?.action || 'GENERAL_CHAT').toUpperCase();
  
  // Handle common aliases
  if (rawIntent === 'STATUS_REPORT' || rawIntent === 'CHART') {
    rawIntent = 'DASHBOARD_CHART';
  }

  const intent: ParsedIntent['intent'] = ALLOWED_INTENTS.has(rawIntent as any) ? (rawIntent as any) : 'GENERAL_CHAT';
  
  // Default to 1.0 if confidence is missing but intent is specific
  const confidence = raw?.confidence !== undefined ? normalizeConfidence(raw.confidence) : (intent === 'GENERAL_CHAT' ? 1.0 : 1.0);

  const task = normalizeTask(raw?.task);
  const cron = normalizeCron(raw?.cron);
  const code = normalizeCode(raw?.code);
  
  return {
    intent,
    task: task && Object.keys(task).length > 0 ? task : undefined,
    cron: cron && Object.keys(cron).length > 0 ? cron : undefined,
    code: code && Object.keys(code).length > 0 ? code : undefined,
    confidence,
  };
}

function normalizeCode(raw: any): ParsedIntent['code'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const code: NonNullable<ParsedIntent['code']> = {};
  
  if (typeof raw.language === 'string') {
    let lang = raw.language.toLowerCase();
    if (['node', 'node.js', 'nodejs', 'js', 'javascript'].includes(lang)) {
      lang = 'javascript';
    } else if (['py', 'python3', 'python'].includes(lang)) {
      lang = 'python';
    } else if (['sh', 'shell', 'bash'].includes(lang)) {
      lang = 'bash';
    }
    code.language = lang as any;
  }
  
  if (typeof raw.snippet === 'string') code.snippet = raw.snippet;
  return code;
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
