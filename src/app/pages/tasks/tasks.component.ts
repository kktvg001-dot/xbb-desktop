import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  interval: 'hourly' | 'daily' | 'weekly';
  enabled: boolean;
  lastRun: string | null;
  status: 'idle' | 'running' | 'completed' | 'failed';
}

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="tasks-page">
      <div class="page-header">
        <h1>Scheduled Tasks</h1>
        <button class="add-btn" (click)="showForm = !showForm">
          {{ showForm ? 'Cancel' : 'Add Task' }}
        </button>
      </div>

      <p class="info-note">Tasks run when the app is open.</p>

      <!-- Add Task Form -->
      <div class="task-form-card" *ngIf="showForm">
        <h2>New Task</h2>
        <div class="form-group">
          <label>Name</label>
          <input type="text" [(ngModel)]="newTask.name" placeholder="e.g. Daily summary" class="form-input" />
        </div>
        <div class="form-group">
          <label>Prompt</label>
          <textarea [(ngModel)]="newTask.prompt" placeholder="Enter the prompt to send to Claude..." class="form-input form-textarea" rows="4"></textarea>
        </div>
        <div class="form-group">
          <label>Interval</label>
          <select [(ngModel)]="newTask.interval" class="form-input">
            <option value="hourly">Every hour</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        <button class="btn btn-primary" (click)="addTask()" [disabled]="!newTask.name || !newTask.prompt">
          Save Task
        </button>
      </div>

      <!-- Task List -->
      <div class="task-list" *ngIf="tasks.length > 0">
        <div class="task-card" *ngFor="let task of tasks">
          <div class="task-header">
            <div class="task-title">
              <h3>{{ task.name }}</h3>
              <span class="task-schedule">{{ formatInterval(task.interval) }}</span>
            </div>
            <div class="task-controls">
              <label class="toggle">
                <input type="checkbox" [checked]="task.enabled" (change)="toggleTask(task)" />
                <span class="toggle-slider"></span>
              </label>
              <button class="delete-btn" (click)="deleteTask(task.id)" title="Delete task">&times;</button>
            </div>
          </div>
          <p class="task-prompt">{{ task.prompt }}</p>
          <div class="task-meta">
            <span class="meta-item">
              <strong>Last run:</strong> {{ task.lastRun ? task.lastRun : 'Never' }}
            </span>
            <span class="meta-item status-badge" [ngClass]="'status-' + task.status">
              {{ task.status }}
            </span>
          </div>
        </div>
      </div>

      <div class="empty-state" *ngIf="tasks.length === 0 && !showForm">
        <p>No scheduled tasks yet. Click "Add Task" to create one.</p>
      </div>
    </div>
  `,
  styles: [`
    .tasks-page {
      padding: 32px;
      max-width: 800px;
      animation: tasksFadeIn 0.4s ease;
    }
    @keyframes tasksFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .page-header h1 {
      font-size: 24px;
      margin: 0;
      color: var(--text-heading);
      letter-spacing: -0.5px;
    }
    .info-note {
      font-size: 13px;
      color: var(--text-muted);
      margin: 0 0 24px;
    }
    .add-btn {
      background: var(--accent-gradient);
      color: #fff;
      border: none;
      padding: 8px 20px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .add-btn:hover {
      box-shadow: 0 4px 16px var(--accent-glow);
      transform: translateY(-1px);
    }

    /* Form */
    .task-form-card {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 1px 4px var(--card-shadow);
      border: 1px solid var(--border);
    }
    .task-form-card h2 {
      font-size: 18px;
      color: var(--text-heading);
      margin: 0 0 16px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .form-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--input-border);
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      background: var(--input-bg);
      color: var(--text-primary);
      box-sizing: border-box;
      transition: all 0.2s ease;
    }
    .form-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }
    .form-textarea {
      resize: vertical;
      min-height: 80px;
    }
    .btn {
      padding: 10px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-primary {
      background: var(--accent-gradient);
      color: #fff;
    }
    .btn-primary:hover:not(:disabled) {
      box-shadow: 0 4px 16px var(--accent-glow);
      transform: translateY(-1px);
    }

    /* Task Cards */
    .task-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .task-card {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 1px 4px var(--card-shadow);
      border: 1px solid var(--border);
      transition: all 0.2s ease;
    }
    .task-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
      border-color: var(--border-hover);
    }
    .task-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .task-title h3 {
      margin: 0;
      font-size: 16px;
      color: var(--text-heading);
    }
    .task-schedule {
      font-size: 12px;
      color: var(--text-muted);
    }
    .task-controls {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .task-prompt {
      font-size: 13px;
      color: var(--text-secondary);
      margin: 0 0 12px;
      white-space: pre-wrap;
      line-height: 1.5;
      max-height: 60px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .task-meta {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .status-badge {
      padding: 2px 10px;
      border-radius: 12px;
      font-weight: 600;
      text-transform: capitalize;
    }
    .status-idle {
      background: var(--bg-hover);
      color: var(--text-muted);
    }
    .status-running {
      background: rgba(124, 92, 252, 0.1);
      color: var(--accent);
    }
    .status-completed {
      background: rgba(34, 197, 94, 0.1);
      color: #22c55e;
    }
    .status-failed {
      background: rgba(239, 68, 68, 0.1);
      color: #ef4444;
    }

    /* Toggle Switch */
    .toggle {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 22px;
    }
    .toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background: var(--border);
      border-radius: 22px;
      transition: 0.2s;
    }
    .toggle-slider::before {
      content: '';
      position: absolute;
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background: #fff;
      border-radius: 50%;
      transition: 0.2s;
    }
    .toggle input:checked + .toggle-slider {
      background: var(--accent);
    }
    .toggle input:checked + .toggle-slider::before {
      transform: translateX(18px);
    }

    /* Delete */
    .delete-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 22px;
      cursor: pointer;
      line-height: 1;
      padding: 0 4px;
    }
    .delete-btn:hover {
      color: #ef4444;
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 48px 0;
      color: var(--text-muted);
      font-size: 14px;
    }
  `],
})
export class TasksComponent implements OnInit {
  private readonly STORAGE_KEY = 'xbb-scheduled-tasks';

  tasks: ScheduledTask[] = [];
  showForm = false;
  newTask = { name: '', prompt: '', interval: 'daily' as ScheduledTask['interval'] };

  ngOnInit() {
    this.loadTasks();
  }

  formatInterval(interval: string): string {
    switch (interval) {
      case 'hourly': return 'Every hour';
      case 'daily': return 'Daily';
      case 'weekly': return 'Weekly';
      default: return interval;
    }
  }

  addTask() {
    const task: ScheduledTask = {
      id: crypto.randomUUID(),
      name: this.newTask.name.trim(),
      prompt: this.newTask.prompt.trim(),
      interval: this.newTask.interval,
      enabled: true,
      lastRun: null,
      status: 'idle',
    };
    this.tasks.unshift(task);
    this.saveTasks();
    this.newTask = { name: '', prompt: '', interval: 'daily' };
    this.showForm = false;
  }

  toggleTask(task: ScheduledTask) {
    task.enabled = !task.enabled;
    this.saveTasks();
  }

  deleteTask(id: string) {
    this.tasks = this.tasks.filter(t => t.id !== id);
    this.saveTasks();
  }

  private loadTasks() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      this.tasks = raw ? JSON.parse(raw) : [];
    } catch {
      this.tasks = [];
    }
  }

  private saveTasks() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.tasks));
  }
}
