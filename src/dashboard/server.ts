import express from 'express';
import http from 'http';
import { DashboardAuth } from './auth.js';
import { DashboardSync } from './websocket.js';
import { createAuthMiddleware, requireRole } from './middleware.js';
import { database } from '../db/database.js';
import { WhatsAppAdapter } from '../whatsapp/adapter.js';
import { config } from '../config.js';

/**
 * Dashboard API server — Express + WebSocket.
 * Provides REST endpoints for the React/Next.js frontend and WebSocket for real-time sync.
 */
export class DashboardServer {
  private app: express.Application;
  private server: http.Server;
  public auth: DashboardAuth;
  public sync: DashboardSync;

  constructor(adapter: WhatsAppAdapter) {
    this.app = express();
    this.app.use(express.json());

    this.server = http.createServer(this.app);
    this.auth = new DashboardAuth(adapter);
    this.sync = new DashboardSync(this.server, this.auth);

    this.app.use(express.static('src/dashboard/public'));

    this.setupRoutes();
  }

  public onWebhook?: (payload: any) => void;

  private setupRoutes() {
    const authMiddleware = createAuthMiddleware(this.auth);

    // --- Public Routes ---
    this.app.post('/api/webhooks/inbound', (req, res) => {
      console.log('🔔 Received inbound webhook payload');
      if (this.onWebhook) {
        this.onWebhook(req.body).catch(err => console.error('Webhook error:', err));
      }
      res.json({ success: true, message: 'Webhook received and processing' });
    });

    this.app.get('/api/public/tasks', (req, res) => {
      const projects = database.getProjects();
      if (projects.length === 0) return res.json([]);
      const projectId = projects[0].id;
      const tasks = database.getTasksByProject(projectId);
      const doneTasks = database.getTasksByProject(projectId, 'done');
      const all = [...tasks, ...doneTasks].map(t => ({
        ...t,
        assigneeName: t.assignedTo ? database.findMemberById(t.assignedTo)?.name : null
      }));
      res.json(all);
    });

    // --- Auth Routes (no JWT required) ---
    this.app.post('/auth/request-code', async (req, res) => {
      const { phone } = req.body;
      const result = await this.auth.requestCode(phone);
      res.json(result);
    });

    this.app.post('/auth/verify', (req, res) => {
      const { phone, code } = req.body;
      const result = this.auth.verifyCode(phone, code);
      res.json(result);
    });

    // --- Protected Routes ---
    this.app.use('/api', authMiddleware);

    // Tasks
    this.app.get('/api/tasks', (req, res) => {
      const user = (req as any).user;
      const tasks = database.getTasksByProject(user.projectId);
      res.json(tasks);
    });

    this.app.patch('/api/tasks/:id', (req, res) => {
      const user = (req as any).user;
      const { field, value } = req.body;
      if (!requireRole(user, field === 'delete' ? 'admin' : 'member')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      // Apply update and broadcast
      res.json({ success: true });
    });

    // Skills (admin only)
    this.app.get('/api/skills', (req, res) => {
      const user = (req as any).user;
      const skills = database.getSkills(user.projectId);
      res.json(skills);
    });

    // Cron Jobs (admin only)
    this.app.get('/api/crons', (req, res) => {
      const user = (req as any).user;
      const jobs = database.getCronJobs(user.projectId);
      res.json(jobs);
    });

    // Activity Feed
    this.app.get('/api/activity', (req, res) => {
      const user = (req as any).user;
      const history = database.getRecentActivity(user.projectId, 50);
      res.json(history);
    });

    // Team
    this.app.get('/api/team', (req, res) => {
      const user = (req as any).user;
      const members = database.getTeamMembers(user.projectId);
      res.json(members.map(m => ({
        ...m,
        phoneNumber: m.phoneNumber.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
      })));
    });
  }

  start() {
    this.server.listen(config.dashboardPort, () => {
      console.log(`🌐 Dashboard API running on http://localhost:${config.dashboardPort}`);
    });
  }
}
