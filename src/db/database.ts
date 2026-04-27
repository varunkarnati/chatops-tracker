import Database from 'better-sqlite3';
import { config } from '../config.js';
import { Task, TeamMember } from '../tasks/models.js';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// Ensure data directory exists
mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    whatsapp_group_id TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    settings TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone_number TEXT UNIQUE NOT NULL,
    whatsapp_id TEXT,
    project_id TEXT REFERENCES projects(id),
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    display_id INTEGER,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium',
    assigned_to TEXT REFERENCES team_members(id),
    created_by TEXT REFERENCES team_members(id),
    deadline DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source_message_id TEXT
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    author_id TEXT REFERENCES team_members(id),
    content TEXT NOT NULL,
    source_message_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS task_history (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    changed_by TEXT REFERENCES team_members(id),
    field_changed TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    project_id TEXT REFERENCES projects(id),
    triggers TEXT NOT NULL,
    behavior TEXT NOT NULL,
    response_format TEXT,
    enabled BOOLEAN DEFAULT 1,
    created_by TEXT REFERENCES team_members(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    display_id INTEGER,
    project_id TEXT REFERENCES projects(id),
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_config TEXT DEFAULT '{}',
    message_template TEXT,
    target_group_id TEXT,
    enabled BOOLEAN DEFAULT 1,
    created_by TEXT REFERENCES team_members(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_run_at DATETIME,
    next_run_at DATETIME
  );

  -- Thread tracking: maps bot reply messages to tasks
  CREATE TABLE IF NOT EXISTS message_task_links (
    bot_message_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    task_display_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    intent TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Persistent group message history (replaces in-memory ring buffer)
  CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    text TEXT NOT NULL,
    message_id TEXT,
    quoted_message_id TEXT,
    timestamp INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Per-user session state for pronoun resolution and context
  CREATE TABLE IF NOT EXISTS user_sessions (
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    last_task_id TEXT,
    last_task_display_id INTEGER,
    last_action TEXT,
    last_intent TEXT,
    recent_intents TEXT DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, project_id)
  );

  -- Indexes for performance
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_display_id ON tasks(project_id, display_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_display_id ON cron_jobs(project_id, display_id);
  CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_group_messages_msg_id ON group_messages(message_id);
`);

// ============================================================
// Row mappers: SQLite returns snake_case, our interfaces use camelCase
// ============================================================

function mapTask(row: any): Task | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    displayId: row.display_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description || undefined,
    status: row.status,
    priority: row.priority,
    assignedTo: row.assigned_to || undefined,
    createdBy: row.created_by || undefined,
    deadline: row.deadline || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceMessageId: row.source_message_id || undefined,
  };
}

function mapMember(row: any): TeamMember | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    phoneNumber: row.phone_number,
    whatsappId: row.whatsapp_id,
    projectId: row.project_id,
    role: row.role,
  };
}

export const database = {
  // --- Projects ---
  getOrCreateProject(groupId: string, groupName: string): string {
    const existing = db.prepare(
      'SELECT id FROM projects WHERE whatsapp_group_id = ?'
    ).get(groupId) as { id: string } | undefined;

    if (existing) return existing.id;

    const id = randomUUID();
    db.prepare(
      'INSERT INTO projects (id, name, whatsapp_group_id) VALUES (?, ?, ?)'
    ).run(id, groupName, groupId);
    return id;
  },

  getProjects(): Array<{ id: string; name: string; whatsapp_group_id: string }> {
    return db.prepare('SELECT id, name, whatsapp_group_id FROM projects ORDER BY created_at ASC').all() as any[];
  },

  getAllProjectGroups(): Map<string, string> {
    const rows = db.prepare('SELECT whatsapp_group_id, id FROM projects').all() as any[];
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.whatsapp_group_id) map.set(row.whatsapp_group_id, row.id);
    }
    return map;
  },

  // --- Team Members ---
  getOrCreateMember(phone: string, name: string, projectId: string): TeamMember {
    const existing = db.prepare(
      'SELECT * FROM team_members WHERE phone_number = ?'
    ).get(phone);

    if (existing) return mapMember(existing)!;

    const id = randomUUID();
    db.prepare(
      'INSERT INTO team_members (id, name, phone_number, whatsapp_id, project_id) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, phone, phone, projectId);
    const row = db.prepare('SELECT * FROM team_members WHERE id = ?').get(id);
    return mapMember(row)!;
  },

  findMemberByPhone(phone: string): TeamMember | undefined {
    const row = db.prepare(
      'SELECT * FROM team_members WHERE phone_number = ? OR whatsapp_id = ?'
    ).get(phone, phone);
    return mapMember(row);
  },

  findMemberByName(name: string, projectId: string): TeamMember | undefined {
    const row = db.prepare(
      'SELECT * FROM team_members WHERE LOWER(name) = ? AND project_id = ?'
    ).get(name.toLowerCase(), projectId);
    return mapMember(row);
  },

  findMemberById(id: string): TeamMember | undefined {
    const row = db.prepare(
      'SELECT * FROM team_members WHERE id = ?'
    ).get(id);
    return mapMember(row);
  },

  getTeamMembers(projectId: string): TeamMember[] {
    const rows = db.prepare(
      'SELECT * FROM team_members WHERE project_id = ? ORDER BY joined_at ASC'
    ).all(projectId);
    return rows.map(r => mapMember(r)!);
  },

  // --- Tasks ---
  createTask(task: Partial<Task> & { projectId: string; title: string }): Task {
    const id = randomUUID();
    const nextDisplayId = (db.prepare(
      'SELECT COALESCE(MAX(display_id), 0) + 1 as next FROM tasks WHERE project_id = ?'
    ).get(task.projectId) as { next: number }).next;

    db.prepare(`
      INSERT INTO tasks (id, display_id, project_id, title, description, status, priority, assigned_to, created_by, deadline, source_message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, nextDisplayId, task.projectId, task.title,
      task.description || null, task.status || 'todo',
      task.priority || 'medium', task.assignedTo || null,
      task.createdBy || null, task.deadline || null,
      task.sourceMessageId || null
    );

    return mapTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id))!;
  },

  getTaskByDisplayId(displayId: number, projectId: string): Task | undefined {
    const row = db.prepare(
      'SELECT * FROM tasks WHERE display_id = ? AND project_id = ?'
    ).get(displayId, projectId);
    return mapTask(row);
  },

  updateTaskStatus(displayId: number, projectId: string, status: string, changedBy?: string): Task | null {
    const row = db.prepare(
      'SELECT * FROM tasks WHERE display_id = ? AND project_id = ?'
    ).get(displayId, projectId);
    const task = mapTask(row);

    if (!task) return null;

    db.prepare('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, task.id);

    if (changedBy) {
      db.prepare(
        'INSERT INTO task_history (id, task_id, changed_by, field_changed, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), task.id, changedBy, 'status', task.status, status);
    }

    return mapTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id))!;
  },

  updateTaskField(displayId: number, projectId: string, field: string, value: string, changedBy?: string): Task | null {
    const row = db.prepare(
      'SELECT * FROM tasks WHERE display_id = ? AND project_id = ?'
    ).get(displayId, projectId);
    const task = mapTask(row);

    if (!task) return null;

    const allowedFields = ['title', 'description', 'priority', 'status', 'assigned_to'];
    if (!allowedFields.includes(field)) return null;

    const oldValue = (task as any)[field];
    db.prepare(`UPDATE tasks SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(value, task.id);

    if (changedBy) {
      db.prepare(
        'INSERT INTO task_history (id, task_id, changed_by, field_changed, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), task.id, changedBy, field, oldValue, value);
    }

    return mapTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id))!;
  },

  deleteTask(taskId: string): void {
    db.prepare('DELETE FROM comments WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM task_history WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  },

  findTaskByTitle(projectId: string, titleFragment: string): Task | undefined {
    const row = db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND LOWER(title) LIKE ? AND status != 'done' ORDER BY created_at DESC LIMIT 1"
    ).get(projectId, `%${titleFragment.toLowerCase()}%`);
    return mapTask(row);
  },

  getTasksByProject(projectId: string, status?: string): Task[] {
    let rows;
    if (status) {
      rows = db.prepare(
        'SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY priority DESC, deadline ASC'
      ).all(projectId, status);
    } else {
      rows = db.prepare(
        "SELECT * FROM tasks WHERE project_id = ? AND status != 'done' ORDER BY priority DESC, deadline ASC"
      ).all(projectId);
    }
    return rows.map(r => mapTask(r)!);
  },

  getTasksByAssignee(memberId: string): Task[] {
    const rows = db.prepare(
      "SELECT * FROM tasks WHERE assigned_to = ? AND status != 'done' ORDER BY deadline ASC"
    ).all(memberId);
    return rows.map(r => mapTask(r)!);
  },

  getOverdueTasks(projectId: string): Task[] {
    const rows = db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND deadline < datetime('now') AND status NOT IN ('done', 'blocked') ORDER BY deadline ASC"
    ).all(projectId);
    return rows.map(r => mapTask(r)!);
  },

  // --- Skills ---
  getSkills(projectId: string): any[] {
    return db.prepare(
      'SELECT * FROM skills WHERE project_id = ? ORDER BY name ASC'
    ).all(projectId);
  },

  createSkill(skill: { id: string; name: string; projectId: string; triggers: string; behavior: string; responseFormat?: string; createdBy?: string }): void {
    db.prepare(`
      INSERT INTO skills (id, name, project_id, triggers, behavior, response_format, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(skill.id, skill.name, skill.projectId, skill.triggers, skill.behavior, skill.responseFormat || null, skill.createdBy || null);
  },

  updateSkill(id: string, updates: Record<string, any>): void {
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    db.prepare(`UPDATE skills SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...values, id);
  },

  deleteSkill(id: string): void {
    db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  },

  getSkillByName(name: string): any | undefined {
    return db.prepare('SELECT * FROM skills WHERE name = ?').get(name);
  },

  // --- Cron Jobs ---
  getCronJobs(projectId: string): any[] {
    return db.prepare(
      'SELECT * FROM cron_jobs WHERE project_id = ? ORDER BY display_id ASC'
    ).all(projectId);
  },

  createCronJob(job: any): any {
    const id = randomUUID();
    const nextDisplayId = (db.prepare(
      'SELECT COALESCE(MAX(display_id), 0) + 1 as next FROM cron_jobs WHERE project_id = ?'
    ).get(job.projectId || job.project_id) as { next: number }).next;

    db.prepare(`
      INSERT INTO cron_jobs (id, display_id, project_id, name, schedule, action_type, action_config, message_template, target_group_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, nextDisplayId, job.projectId || job.project_id, job.name, job.schedule,
      job.actionType || job.action_type, JSON.stringify(job.actionConfig || {}),
      job.messageTemplate || job.message_template || null,
      job.targetGroupId || job.target_group_id || null,
      job.createdBy || job.created_by || null
    );

    return db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id);
  },

  getCronJobByDisplayId(displayId: number, projectId: string): any | undefined {
    return db.prepare(
      'SELECT * FROM cron_jobs WHERE display_id = ? AND project_id = ?'
    ).get(displayId, projectId);
  },

  updateCronJob(id: string, updates: Record<string, any>): void {
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    db.prepare(`UPDATE cron_jobs SET ${fields} WHERE id = ?`)
      .run(...values, id);
  },

  deleteCronJob(id: string): void {
    db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
  },

  // --- Activity / History ---
  getRecentActivity(projectId: string, limit: number = 50): any[] {
    return db.prepare(`
      SELECT th.*, t.display_id, t.title as task_title, tm.name as changed_by_name
      FROM task_history th
      JOIN tasks t ON th.task_id = t.id
      LEFT JOIN team_members tm ON th.changed_by = tm.id
      WHERE t.project_id = ?
      ORDER BY th.changed_at DESC
      LIMIT ?
    `).all(projectId, limit);
  },

  // --- Message Thread Tracking ---
  linkMessageToTask(botMessageId: string, taskId: string, taskDisplayId: number, projectId: string, intent: string): void {
    db.prepare(`
      INSERT OR REPLACE INTO message_task_links (bot_message_id, task_id, task_display_id, project_id, intent)
      VALUES (?, ?, ?, ?, ?)
    `).run(botMessageId, taskId, taskDisplayId, projectId, intent);
  },

  getTaskByBotMessageId(botMessageId: string): { taskId: string; taskDisplayId: number; projectId: string; intent: string } | undefined {
    const row = db.prepare(
      'SELECT task_id, task_display_id, project_id, intent FROM message_task_links WHERE bot_message_id = ?'
    ).get(botMessageId) as any;
    if (!row) return undefined;
    return {
      taskId: row.task_id,
      taskDisplayId: row.task_display_id,
      projectId: row.project_id,
      intent: row.intent,
    };
  },

  // --- Persistent Group History ---
  storeGroupMessage(groupId: string, senderName: string, senderId: string, text: string, messageId: string | undefined, quotedMessageId: string | undefined, timestamp: number): void {
    db.prepare(`
      INSERT INTO group_messages (group_id, sender_name, sender_id, text, message_id, quoted_message_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(groupId, senderName, senderId, text, messageId || null, quotedMessageId || null, timestamp);
  },

  getRecentGroupMessages(groupId: string, limit: number = 20): Array<{ senderName: string; senderId: string; text: string; messageId: string | null; timestamp: number }> {
    return db.prepare(`
      SELECT sender_name as senderName, sender_id as senderId, text, message_id as messageId, timestamp
      FROM group_messages
      WHERE group_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(groupId, limit).reverse() as any[];
  },

  getMessageByMessageId(messageId: string): { senderName: string; text: string; timestamp: number } | undefined {
    return db.prepare(
      'SELECT sender_name as senderName, text, timestamp FROM group_messages WHERE message_id = ? LIMIT 1'
    ).get(messageId) as any;
  },

  // --- User Sessions ---
  getUserSession(userId: string, projectId: string): { lastTaskId: string | null; lastTaskDisplayId: number | null; lastAction: string | null; lastIntent: string | null; recentIntents: string[] } {
    const row = db.prepare(
      'SELECT last_task_id, last_task_display_id, last_action, last_intent, recent_intents FROM user_sessions WHERE user_id = ? AND project_id = ?'
    ).get(userId, projectId) as any;

    if (!row) {
      return { lastTaskId: null, lastTaskDisplayId: null, lastAction: null, lastIntent: null, recentIntents: [] };
    }
    return {
      lastTaskId: row.last_task_id,
      lastTaskDisplayId: row.last_task_display_id,
      lastAction: row.last_action,
      lastIntent: row.last_intent,
      recentIntents: JSON.parse(row.recent_intents || '[]'),
    };
  },

  updateUserSession(userId: string, projectId: string, update: { lastTaskId?: string; lastTaskDisplayId?: number; lastAction?: string; lastIntent?: string }): void {
    const existing = db.prepare(
      'SELECT recent_intents FROM user_sessions WHERE user_id = ? AND project_id = ?'
    ).get(userId, projectId) as any;

    let recentIntents: string[] = existing ? JSON.parse(existing.recent_intents || '[]') : [];
    if (update.lastIntent) {
      recentIntents.push(update.lastIntent);
      if (recentIntents.length > 5) recentIntents = recentIntents.slice(-5);
    }

    db.prepare(`
      INSERT INTO user_sessions (user_id, project_id, last_task_id, last_task_display_id, last_action, last_intent, recent_intents, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, project_id) DO UPDATE SET
        last_task_id = COALESCE(excluded.last_task_id, last_task_id),
        last_task_display_id = COALESCE(excluded.last_task_display_id, last_task_display_id),
        last_action = COALESCE(excluded.last_action, last_action),
        last_intent = COALESCE(excluded.last_intent, last_intent),
        recent_intents = excluded.recent_intents,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      userId, projectId,
      update.lastTaskId || null,
      update.lastTaskDisplayId || null,
      update.lastAction || null,
      update.lastIntent || null,
      JSON.stringify(recentIntents)
    );
  },

  // --- Cleanup ---
  close(): void {
    db.close();
  },
};
