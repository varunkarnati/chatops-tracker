import { watch } from 'fs';
import { join } from 'path';
import { SkillRegistry } from '../context/skill-registry.js';

/**
 * HotReloader — watches workspace/skills/ for changes and reloads the SkillRegistry.
 * Uses a 1.5-second debounce (same as OpenClaw's memory file watcher).
 */
export class HotReloader {
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(
    private skillRegistry: SkillRegistry,
    private workspacePath: string
  ) {
    const skillsDir = join(workspacePath, 'skills');

    try {
      watch(skillsDir, { recursive: true }, (event, filename) => {
        if (!filename?.endsWith('.md')) return;

        // Debounce — don't reload on every keystroke during a multi-file write
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          console.log(`🔄 Skill change detected: ${filename} — reloading...`);
          this.skillRegistry.reload();
        }, 1500); // 1.5s debounce (same as OpenClaw)
      });

      console.log('👁️ Watching workspace/skills/ for changes...');
    } catch {
      console.log('⚠️ Could not watch skills directory (may not exist yet)');
    }
  }
}
