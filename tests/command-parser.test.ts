import { describe, it, expect, vi } from 'vitest';

// Mock config before importing command-parser
vi.mock('../src/config.js', () => ({
  config: {
    commandPrefix: '!',
    botName: 'TaskBot'
  }
}));

import { parseCommand } from '../src/parser/command-parser.js';

describe('Command Parser (Non-LLM)', () => {
  it('should ignore messages without the prefix', () => {
    expect(parseCommand('hello world', [])).toBeNull();
  });

  it('should parse !task command', () => {
    const result = parseCommand('!task Design logo @123456 by Friday', ['123456']);
    expect(result?.kind).toBe('intent');
    if (result?.kind === 'intent') {
      expect(result.intent.intent).toBe('CREATE_TASK');
      expect(result.intent.task?.title).toBe('Design logo');
      expect(result.intent.task?.assigneePhone).toBe('123456');
      expect(result.intent.task?.deadline).toBe('Friday');
    }
  });

  it('should parse !done command', () => {
    const result = parseCommand('!done 42', []);
    expect(result?.kind).toBe('intent');
    if (result?.kind === 'intent') {
      expect(result.intent.intent).toBe('UPDATE_STATUS');
      expect(result.intent.task?.relatedTaskId).toBe(42);
      expect(result.intent.task?.status).toBe('done');
    }
  });

  it('should parse !status command', () => {
    const result = parseCommand('!status', []);
    expect(result?.kind).toBe('intent');
    if (result?.kind === 'intent') {
      expect(result.intent.intent).toBe('QUERY_STATUS');
    }
  });

  it('should parse !skill subcommands', () => {
    const result = parseCommand('!skill add weather', []);
    expect(result?.kind).toBe('manager');
    if (result?.kind === 'manager') {
      expect(result.command.type).toBe('skill');
      expect(result.command.subcommand).toBe('add');
      expect(result.command.args).toContain('weather');
    }
  });

  it('should parse !edit command correctly', () => {
    const result = parseCommand('!edit 5 priority high', []);
    expect(result?.kind).toBe('intent');
    if (result?.kind === 'intent') {
      expect(result.intent.intent).toBe('EDIT_TASK');
      expect(result.intent.task?.relatedTaskId).toBe(5);
      expect(result.intent.task?.editField).toBe('priority');
      expect(result.intent.task?.editValue).toBe('high');
    }
  });

  it('should return null for unknown commands', () => {
    expect(parseCommand('!unknownCommand', [])).toBeNull();
  });
});
