import { describe, it, expect } from 'vitest';
import { extractJsonPayload, normalizeParsedIntent } from '../src/parser/llm-parser.js';

describe('LLM Parser Utils', () => {
  describe('extractJsonPayload', () => {
    it('should extract JSON from markdown blocks', () => {
      const input = 'Here is the result:\n```json\n{"intent": "CREATE_TASK"}\n```';
      expect(extractJsonPayload(input)).toBe('{"intent": "CREATE_TASK"}');
    });

    it('should strip reasoning blocks', () => {
      const input = '<think>I should do X</think>{"intent": "CREATE_TASK"}';
      expect(extractJsonPayload(input)).toBe('{"intent": "CREATE_TASK"}');
    });

    it('should find braces if mixed with text', () => {
      const input = 'Sure! Here it is: {"intent": "GENERAL_CHAT"} hope that helps!';
      expect(extractJsonPayload(input)).toBe('{"intent": "GENERAL_CHAT"}');
    });
  });

  describe('normalizeParsedIntent', () => {
    it('should default to GENERAL_CHAT for unknown intents', () => {
      const result = normalizeParsedIntent({ intent: 'NOT_A_REAL_INTENT' });
      expect(result.intent).toBe('GENERAL_CHAT');
    });

    it('should normalize relatedTaskId to number', () => {
      const result = normalizeParsedIntent({ 
        intent: 'UPDATE_STATUS', 
        task: { relatedTaskId: "5", status: "done" } 
      });
      expect(result.task?.relatedTaskId).toBe(5);
    });

    it('should map aliases like CHART to DASHBOARD_CHART', () => {
      const result = normalizeParsedIntent({ intent: 'CHART' });
      expect(result.intent).toBe('DASHBOARD_CHART');
    });

    it('should normalize code languages', () => {
      const result = normalizeParsedIntent({
        intent: 'EXECUTE_CODE',
        code: { language: 'node.js', snippet: 'console.log(1)' }
      });
      expect(result.code?.language).toBe('javascript');
    });
  });
});
