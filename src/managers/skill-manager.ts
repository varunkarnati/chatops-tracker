import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { database } from '../db/database.js';
import { SkillRegistry } from '../context/skill-registry.js';
import { config } from '../config.js';

/**
 * SkillManager — CRUD for skills via WhatsApp commands.
 * Skills are stored in the DB and synced to SKILL.md files for the ContextAssembler.
 */
export class SkillManager {
  constructor(private skillRegistry: SkillRegistry) {}

  async createSkill(
    name: string, triggers: string[], behavior: string,
    responseFormat: string, projectId: string, createdBy: string
  ): Promise<{ id: string; name: string }> {
    const id = randomUUID();
    database.createSkill({
      id, name, projectId,
      triggers: JSON.stringify(triggers),
      behavior, responseFormat, createdBy,
    });

    // Generate and write SKILL.md file
    const skillMd = this.generateSkillMd(name, triggers, behavior, responseFormat);
    const skillDir = join(config.workspacePath, 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), skillMd);

    // Hot-reload the SkillRegistry
    this.skillRegistry.reload();
    return { id, name };
  }

  editTriggers(name: string, newTriggers: string[]) {
    const skill = database.getSkillByName(name);
    if (!skill) throw new Error(`Skill "${name}" not found`);
    database.updateSkill(skill.id, { triggers: JSON.stringify(newTriggers) });
    this.syncToFile(name);
    this.skillRegistry.reload();
  }

  toggleSkill(name: string, enabled: boolean) {
    const skill = database.getSkillByName(name);
    if (!skill) throw new Error(`Skill "${name}" not found`);
    database.updateSkill(skill.id, { enabled: enabled ? 1 : 0 });
    this.skillRegistry.setEnabled(name, enabled);
  }

  deleteSkill(name: string) {
    const skill = database.getSkillByName(name);
    if (!skill) throw new Error(`Skill "${name}" not found`);
    database.deleteSkill(skill.id);
    this.skillRegistry.reload();
  }

  listSkills(projectId: string): string {
    const skills = database.getSkills(projectId);
    if (skills.length === 0) return '🎯 *No skills registered.* Use `!skill add <name>` to create one.';

    let msg = `🎯 *Skills* (${skills.length})\n━━━━━━━━━━━━━━━━━\n`;
    for (const s of skills) {
      const status = s.enabled ? '🟢' : '⏸️';
      const triggers = JSON.parse(s.triggers || '[]').join(', ');
      msg += `${status} *${s.name}*\n   Triggers: ${triggers}\n\n`;
    }
    return msg;
  }

  private generateSkillMd(name: string, triggers: string[], behavior: string, responseFormat: string): string {
    return `# Skill: ${name}\n\n` +
      `## Trigger\nActivate when message contains: ${triggers.map(t => `"${t}"`).join(', ')}\n\n` +
      `## Behavior\n${behavior}\n\n` +
      `## Response Format\n${responseFormat}\n`;
  }

  private syncToFile(name: string) {
    const skill = database.getSkillByName(name);
    if (!skill) return;
    const triggers = JSON.parse(skill.triggers || '[]');
    const skillMd = this.generateSkillMd(name, triggers, skill.behavior, skill.response_format || '');
    const skillDir = join(config.workspacePath, 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), skillMd);
  }
}
