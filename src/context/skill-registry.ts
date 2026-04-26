import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface Skill {
  name: string;
  triggers: RegExp[];
  promptContent: string;
  enabled: boolean;
}

export class SkillRegistry {
  private skills: Skill[] = [];
  private skillsDir: string = '';

  loadFromDirectory(skillsDir: string) {
    this.skillsDir = skillsDir;
    if (!existsSync(skillsDir)) return;

    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    this.skills = [];

    for (const dir of dirs) {
      const skillPath = join(skillsDir, dir.name, 'SKILL.md');
      if (existsSync(skillPath)) {
        const content = readFileSync(skillPath, 'utf-8');
        const triggers = this.extractTriggers(content);
        this.skills.push({ name: dir.name, triggers, promptContent: content, enabled: true });
      }
    }

    console.log(`🎯 Loaded ${this.skills.length} skills: ${this.skills.map(s => s.name).join(', ') || 'none'}`);
  }

  reload() {
    if (this.skillsDir) this.loadFromDirectory(this.skillsDir);
  }

  findMatchingSkill(messageText: string): Skill | null {
    for (const skill of this.skills) {
      if (!skill.enabled) continue;
      if (skill.triggers.some(t => t.test(messageText))) return skill;
    }
    return null;
  }

  getAll(): Skill[] { return [...this.skills]; }

  setEnabled(name: string, enabled: boolean): boolean {
    const skill = this.skills.find(s => s.name === name);
    if (skill) { skill.enabled = enabled; return true; }
    return false;
  }

  private extractTriggers(skillContent: string): RegExp[] {
    const triggerSection = skillContent.match(/## Trigger[\s\S]*?(?=##|$)/)?.[0] || '';
    const keywords = triggerSection.match(/"([^"]+)"/g)?.map(k => k.replace(/"/g, '')) || [];
    return keywords.map(k => new RegExp(k, 'i'));
  }
}
