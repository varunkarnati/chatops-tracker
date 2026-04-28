import { describe, it, expect, beforeEach } from 'vitest';
import { database, initTestDatabase } from '../src/db/database.js';

describe('Database Integration', () => {
  beforeEach(() => {
    // Start with a fresh in-memory database for every test
    initTestDatabase(':memory:');
  });

  it('should create and retrieve a project', () => {
    const projectId = database.getOrCreateProject('group-123', 'Test Project');
    expect(projectId).toBeDefined();

    const retrieved = database.getProjectByGroupId('group-123');
    expect(retrieved?.id).toBe(projectId);
  });

  it('should handle team members', () => {
    const projectId = database.getOrCreateProject('G1', 'P1');
    const member = database.getOrCreateMember('+123456', 'Stan', projectId);
    
    expect(member.name).toBe('Stan');
    expect(member.phoneNumber).toBe('+123456');

    const found = database.findMemberByPhone('+123456');
    expect(found?.id).toBe(member.id);
  });

  it('should create and increment task display IDs', () => {
    const projectId = database.getOrCreateProject('G1', 'P1');
    const task1 = database.createTask({ projectId, title: 'Task 1' });
    const task2 = database.createTask({ projectId, title: 'Task 2' });

    expect(task1.displayId).toBe(1);
    expect(task2.displayId).toBe(2);
  });

  it('should update task status', () => {
    const projectId = database.getOrCreateProject('G1', 'P1');
    const member = database.getOrCreateMember('+123', 'Tester', projectId);
    const task = database.createTask({ projectId, title: 'Test Task' });
    
    const updated = database.updateTaskStatus(task.displayId, projectId, 'in_progress', member.id);
    expect(updated?.status).toBe('in_progress');
    
    const retrieved = database.getTaskByDisplayId(task.displayId, projectId);
    expect(retrieved?.status).toBe('in_progress');
  });

  it('should track user sessions', () => {
    const projectId = database.getOrCreateProject('G1', 'P1');
    database.updateUserSession('user-1', projectId, { 
      lastTaskId: 'task-123', 
      lastTaskDisplayId: 5 
    });

    const session = database.getUserSession('user-1', projectId);
    expect(session?.lastTaskDisplayId).toBe(5);
    expect(session?.lastTaskId).toBe('task-123');
  });
});
