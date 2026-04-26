export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type MemberRole = 'admin' | 'member' | 'viewer';

export interface Task {
  id: string;
  displayId: number;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo?: string;
  createdBy?: string;
  deadline?: string;
  createdAt: string;
  updatedAt: string;
  sourceMessageId?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  phoneNumber: string;
  whatsappId: string;
  projectId: string;
  role: MemberRole;
}

export interface ParsedIntent {
  intent:
    | 'CREATE_TASK'
    | 'UPDATE_STATUS'
    | 'ASSIGN_TASK'
    | 'SET_DEADLINE'
    | 'QUERY_STATUS'
    | 'ADD_COMMENT'
    | 'SET_PRIORITY'
    | 'BLOCK_TASK'
    | 'EDIT_TASK'
    | 'DELETE_TASK'
    | 'GENERAL_CHAT';
  task?: {
    title?: string;
    assigneePhone?: string;
    deadline?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    relatedTaskId?: number;
    blockReason?: string;
    editField?: string;
    editValue?: string;
  };
  confidence: number;
}

export interface NormalizedMessage {
  id: string;
  groupId: string;
  groupName: string;
  senderId: string;
  senderName: string;
  text: string;
  mentions: string[];
  quotedMessage?: {
    id: string;
    text: string;
    senderId: string;
  };
  timestamp: number;
  mediaType?: 'image' | 'document' | 'audio';
  mediaUrl?: string;
}
