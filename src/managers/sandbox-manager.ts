import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const execAsync = promisify(exec);

export class SandboxManager {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(process.cwd(), '.openclaw', 'sandbox');
  }

  async init() {
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  /**
   * Executes code safely inside a short-lived Docker container.
   * If Docker is not available, it throws an error to prevent unsafe execution on the host.
   */
  async executeCode(language: 'python' | 'javascript' | 'bash', snippet: string): Promise<string> {
    const runId = crypto.randomUUID();
    const isWindows = process.platform === 'win32';
    
    try {
      // 1. Verify Docker is running
      await execAsync('docker --version');
    } catch (e) {
      return `❌ Sandbox Error: Docker is not running or not installed. Code execution requires Docker for safety.`;
    }

    let result = '';
    
    if (language === 'python') {
      // Python execution
      const scriptPath = path.join(this.tempDir, `${runId}.py`);
      await fs.writeFile(scriptPath, snippet, 'utf-8');
      
      try {
        // Run python script inside a disposable container.
        // Mount only the specific file as read-only.
        const mountPath = isWindows ? scriptPath.replace(/\\/g, '/') : scriptPath;
        const cmd = `docker run --rm --memory="128m" --cpus="0.5" -v "${mountPath}:/app/script.py:ro" python:3.10-alpine python /app/script.py`;
        
        const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
        result = stdout + (stderr ? `\n[Errors]:\n${stderr}` : '');
      } catch (error: any) {
        result = `❌ Execution failed or timed out: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`;
      } finally {
        await fs.unlink(scriptPath).catch(() => {}); // cleanup
      }
    } else if (language === 'javascript') {
      // Node execution
      const scriptPath = path.join(this.tempDir, `${runId}.js`);
      await fs.writeFile(scriptPath, snippet, 'utf-8');
      
      try {
        const mountPath = isWindows ? scriptPath.replace(/\\/g, '/') : scriptPath;
        const cmd = `docker run --rm --memory="128m" --cpus="0.5" -v "${mountPath}:/app/script.js:ro" node:18-alpine node /app/script.js`;
        
        const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
        result = stdout + (stderr ? `\n[Errors]:\n${stderr}` : '');
      } catch (error: any) {
        result = `❌ Execution failed or timed out: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`;
      } finally {
        await fs.unlink(scriptPath).catch(() => {});
      }
    } else if (language === 'bash') {
      // Bash execution
      const scriptPath = path.join(this.tempDir, `${runId}.sh`);
      await fs.writeFile(scriptPath, snippet, 'utf-8');
      
      try {
        const mountPath = isWindows ? scriptPath.replace(/\\/g, '/') : scriptPath;
        const cmd = `docker run --rm --memory="128m" --cpus="0.5" -v "${mountPath}:/app/script.sh:ro" alpine:latest sh /app/script.sh`;
        
        const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
        result = stdout + (stderr ? `\n[Errors]:\n${stderr}` : '');
      } catch (error: any) {
        result = `❌ Execution failed or timed out: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`;
      } finally {
        await fs.unlink(scriptPath).catch(() => {});
      }
    } else {
      return `❌ Unsupported language for sandboxing: ${language}`;
    }

    // Truncate if output is too long for WhatsApp
    if (result.length > 2000) {
      result = result.substring(0, 2000) + '\n\n...[Output Truncated]';
    }

    return result || '✅ Code executed successfully with no output.';
  }
}
