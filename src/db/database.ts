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
`);

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

  // --- Team Members ---
  getOrCreateMember(phone: string, name: string, projectId: string): TeamMember {
    let member = db.prepare(
      'SELECT * FROM team_members WHERE phone_number = ?'
    ).get(phone) as TeamMember | undefined;

    if (!member) {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO team_members (id, name, phone_number, whatsapp_id, project_id) VALUES (?, ?, ?, ?, ?)'
      ).run(id, name, phone, phone, projectId);
      member = db.prepare('SELECT * FROM team_members WHERE id = ?').get(id) as TeamMember;
    }
    return member;
  },

  findMemberByPhone(phone: string): TeamMember | undefined {
    return db.prepare(
      'SELECT * FROM team_members WHERE phone_number = ? OR whatsapp_id = ?'
    ).get(phone, phone) as TeamMember | undefined;
  },

  getTeamMembers(projectId: string): TeamMember[] {
    return db.prepare(
      'SELECT * FROM team_members WHERE project_id = ? ORDER BY joined_at ASC'
    ).all(projectId) as TeamMember[];
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

    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task;
  },

  getTaskByDisplayId(displayId: number, projectId: string): Task | undefined {
    return db.prepare(
      'SELECT * FROM tasks WHERE display_id = ? AND project_id = ?'
    ).get(displayId, projectId) as Task | undefined;
  },

  updateTaskStatus(displayId: number, projectId: string, status: string, changedBy?: string): Task | null {
    const task = db.prepare(
      'SELECT * FROM tasks WHERE display_id = ? AND project_id = ?'
    ).get(displayId, projectId) as Task | undefined;

    if (!task) return null;

    db.prepare('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, task.id);

    if (changedBy) {
      db.prepare(
        'INSERT INTO task_history (id, task_id, changed_by, field_changed, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), task.id, changedBy, 'status', task.status, status);
    }

    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as Task;
  },

  updateTaskField(displayId: number, projectId: string, field: string, value: string, changedBy?: string): Task | null {
    const task = db.prepare(
      'SELECT * FROM tasks WHERE display_id = ? AND project_id = ?'
    ).get(displayId, projectId) as Task | undefined;

    if (!task) return null;

    const allowedFields = ['title', 'description', 'priority', 'status'];
    if (!allowedFields.includes(field)) return null;

    const oldValue = (task as any)[field];
    db.prepare(`UPDATE tasks SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(value, task.id);

    if (changedBy) {
      db.prepare(
        'INSERT INTO task_history (id, task_id, changed_by, field_changed, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), task.id, changedBy, field, oldValue, value);
    }

    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as Task;
  },

  deleteTask(taskId: string): void {
    db.prepare('DELETE FROM comments WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM task_history WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  },

  findTaskByTitle(projectId: string, titleFragment: string): Task | undefined {
    return db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND LOWER(title) LIKE ? AND status != 'done' ORDER BY created_at DESC LIMIT 1"
    ).get(projectId, `%${titleFragment.toLowerCase()}%`) as Task | undefined;
  },

  getTasksByProject(projectId: string, status?: string): Task[] {
    if (status) {
      return db.prepare(
        'SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY priority DESC, deadline ASC'
      ).all(projectId, status) as Task[];
    }
    return db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND status != 'done' ORDER BY priority DESC, deadline ASC"
    ).all(projectId) as Task[];
  },

  getTasksByAssignee(memberId: string): Task[] {
    return db.prepare(
      "SELECT * FROM tasks WHERE assigned_to = ? AND status != 'done' ORDER BY deadline ASC"
    ).all(memberId) as Task[];
  },

  getOverdueTasks(projectId: string): Task[] {
    return db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND deadline < datetime('now') AND status NOT IN ('done', 'blocked') ORDER BY deadline ASC"
    ).all(projectId) as Task[];
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
};
