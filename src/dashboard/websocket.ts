import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { DashboardAuth } from './auth.js';
import { database } from '../db/database.js';

/**
 * DashboardSync — real-time WebSocket sync between WhatsApp and the web dashboard.
 * When tasks change from either source, all connected clients are notified instantly.
 */
export class DashboardSync {
  private wss: WebSocketServer;
  private clients: Map<string, WebSocket[]> = new Map(); // projectId → connected clients

  constructor(server: http.Server, private auth: DashboardAuth) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      const user = token ? this.auth.verifyToken(token) : null;

      if (!user) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      // Track connected client by project
      if (!this.clients.has(user.projectId)) this.clients.set(user.projectId, []);
      this.clients.get(user.projectId)!.push(ws);

      ws.on('message', (data) => {
        try {
          this.handleClientMessage(JSON.parse(data.toString()), user);
        } catch (e) {
          console.error('WebSocket message error:', e);
        }
      });

      ws.on('close', () => {
        const arr = this.clients.get(user.projectId) || [];
        this.clients.set(user.projectId, arr.filter(c => c !== ws));
      });
    });
  }

  /**
   * Broadcast an event to all dashboard clients watching a given project.
   * Called by the bot when tasks change from WhatsApp or cron.
   */
  broadcastToProject(projectId: string, event: string, data: any) {
    const clients = this.clients.get(projectId) || [];
    const message = JSON.stringify({ event, data, timestamp: Date.now() });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(message);
    }
  }

  private handleClientMessage(msg: any, user: any) {
    switch (msg.event) {
      case 'task:move':
        database.updateTaskStatus(msg.taskId, user.projectId, msg.newStatus, user.memberId);
        this.broadcastToProject(user.projectId, 'task:updated', {
          taskId: msg.taskId, status: msg.newStatus, updatedBy: user.memberId, source: 'dashboard'
        });
        break;

      case 'task:create':
        // Handle task creation from dashboard
        break;
    }
  }
}
