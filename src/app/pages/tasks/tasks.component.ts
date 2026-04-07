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
      color: #1a1a2e;
    }
    .info-note {
      font-size: 13px;
      color: #888;
      margin: 0 0 24px;
    }
    .add-btn {
      background: #00a884;
      color: #fff;
      border: none;
      padding: 8px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .add-btn:hover {
      background: #009974;
    }

    /* Form */
    .task-form-card {
      background: #fff;
      border-radius: 10px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .task-form-card h2 {
      font-size: 18px;
      color: #1a1a2e;
      margin: 0 0 16px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #555;
      margin-bottom: 6px;
    }
    .form-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      background: #fafafa;
      box-sizing: border-box;
    }
    .form-input:focus {
      outline: none;
      border-color: #00a884;
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
      background: #00a884;
      color: #fff;
    }
    .btn-primary:hover:not(:disabled) {
      background: #009974;
    }

    /* Task Cards */
    .task-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .task-card {
      background: #fff;
      border-radius: 10px;
      padding: 20px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
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
      color: #1a1a2e;
    }
    .task-schedule {
      font-size: 12px;
      color: #888;
    }
    .task-controls {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .task-prompt {
      font-size: 13px;
      color: #666;
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
      color: #888;
    }
    .status-badge {
      padding: 2px 10px;
      border-radius: 12px;
      font-weight: 600;
      text-transform: capitalize;
    }
    .status-idle {
      background: #f0f0f0;
      color: #888;
    }
    .status-running {
      background: #e3f2fd;
      color: #1565c0;
    }
    .status-completed {
      background: #e8f5e9;
      color: #2e7d32;
    }
    .status-failed {
      background: #fce4ec;
      color: #c62828;
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
      background: #ccc;
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
      background: #00a884;
    }
    .toggle input:checked + .toggle-slider::before {
      transform: translateX(18px);
    }

    /* Delete */
    .delete-btn {
      background: none;
      border: none;
      color: #bbb;
      font-size: 22px;
      cursor: pointer;
      line-height: 1;
      padding: 0 4px;
    }
    .delete-btn:hover {
      color: #f44336;
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 48px 0;
      color: #888;
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
