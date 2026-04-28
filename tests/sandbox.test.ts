import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SandboxManager } from '../src/managers/sandbox-manager.js';
import fs from 'fs/promises';
import { exec } from 'child_process';

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn()
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined)
  }
}));

describe('SandboxManager', () => {
  let sandbox: SandboxManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sandbox = new SandboxManager();
  });

  it('should initialize the sandbox directory', async () => {
    await sandbox.init();
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('sandbox'), { recursive: true });
  });

  it('should generate correct docker command for python', async () => {
    // Mock docker version check and execution
    (exec as any).mockImplementation((cmd, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      if (cmd === 'docker --version') {
        callback(null, { stdout: 'Docker version 20.10.7' });
      } else {
        callback(null, { stdout: 'hello from python' });
      }
    });

    const result = await sandbox.executeCode('python', 'print("hello")');
    
    // Check that it verified docker version first
    expect(exec).toHaveBeenCalledWith('docker --version', expect.any(Function));
    
    // Check the actual docker run command
    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining('docker run --rm --memory="128m" --cpus="0.5"'),
      expect.any(Object),
      expect.any(Function)
    );
    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining('python:3.10-alpine python /app/script.py'),
      expect.any(Object),
      expect.any(Function)
    );
    expect(result).toBe('hello from python');
  });

  it('should generate correct docker command for javascript', async () => {
    (exec as any).mockImplementation((cmd, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      if (cmd === 'docker --version') {
        callback(null, { stdout: 'Docker version 20.10.7' });
      } else {
        callback(null, { stdout: 'node output' });
      }
    });

    const result = await sandbox.executeCode('javascript', 'console.log("node")');
    
    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining('node:18-alpine node /app/script.js'),
      expect.any(Object),
      expect.any(Function)
    );
    expect(result).toBe('node output');
  });

  it('should return error if docker is not running', async () => {
    (exec as any).mockImplementation((cmd, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      if (cmd === 'docker --version') {
        callback(new Error('command not found'));
      }
    });

    const result = await sandbox.executeCode('python', 'print(1)');
    expect(result).toContain('❌ Sandbox Error: Docker is not running');
  });

  it('should handle execution timeouts', async () => {
    (exec as any).mockImplementation((cmd, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      if (cmd === 'docker --version') {
        callback(null, { stdout: 'Docker version' });
      } else {
        callback({ message: 'timed out', stdout: '', stderr: '' });
      }
    });

    const result = await sandbox.executeCode('bash', 'sleep 20');
    expect(result).toContain('❌ Execution failed or timed out');
  });
});
