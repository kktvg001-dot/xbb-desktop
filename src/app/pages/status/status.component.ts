import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OpenclawService, OpenclawStatus } from '../../services/openclaw.service';

@Component({
  selector: 'app-status',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="status-page">
      <div class="page-header">
        <h1>System Status</h1>
        <button class="refresh-btn" (click)="refresh()" [disabled]="loading">
          {{ loading ? 'Checking...' : 'Refresh' }}
        </button>
      </div>

      <div class="status-grid">
        <div class="status-card">
          <div class="status-dot" [class.green]="status?.whatsapp === 'connected'" [class.red]="status?.whatsapp !== 'connected'"></div>
          <div class="status-info">
            <h3>WhatsApp Connection</h3>
            <p class="status-value" [class.connected]="status?.whatsapp === 'connected'">
              {{ status?.whatsapp === 'connected' ? 'Connected' : status?.whatsapp === 'disconnected' ? 'Disconnected' : 'Unknown' }}
            </p>
          </div>
        </div>

        <div class="status-card">
          <div class="status-dot" [class.green]="status?.gateway" [class.red]="!status?.gateway"></div>
          <div class="status-info">
            <h3>Gateway</h3>
            <p class="status-value" [class.connected]="status?.gateway">
              {{ status?.gateway ? 'Running' : 'Stopped' }}
            </p>
          </div>
        </div>

        <div class="status-card">
          <div class="status-dot neutral"></div>
          <div class="status-info">
            <h3>Agents</h3>
            <p class="status-value">{{ agentCount }}</p>
          </div>
        </div>
      </div>

      <div class="actions-section">
        <h2>Actions</h2>
        <div class="action-buttons">
          <button class="btn btn-primary" (click)="restartGateway()" [disabled]="restarting">
            {{ restarting ? 'Restarting...' : 'Restart Gateway' }}
          </button>
          <button class="btn btn-secondary" (click)="viewLogs()">
            View Logs
          </button>
        </div>
        <p class="action-result" *ngIf="actionMessage" [class.error]="actionError">{{ actionMessage }}</p>
      </div>

      <div class="raw-output" *ngIf="status?.raw">
        <h2>Raw Output</h2>
        <pre>{{ status.raw }}</pre>
      </div>
    </div>
  `,
  styles: [`
    .status-page {
      padding: 32px;
      max-width: 800px;
    }
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 28px;
    }
    .page-header h1 {
      font-size: 24px;
      margin: 0;
      color: #1a1a2e;
    }
    .refresh-btn {
      background: #00a884;
      color: #fff;
      border: none;
      padding: 8px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .refresh-btn:disabled {
      opacity: 0.5;
    }
    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .status-card {
      background: #fff;
      border-radius: 10px;
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 16px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .status-dot {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #bbb;
    }
    .status-dot.green {
      background: #4caf50;
      box-shadow: 0 0 8px rgba(76, 175, 80, 0.4);
    }
    .status-dot.red {
      background: #f44336;
      box-shadow: 0 0 8px rgba(244, 67, 54, 0.4);
    }
    .status-dot.neutral {
      background: #2196f3;
    }
    .status-info h3 {
      margin: 0 0 4px;
      font-size: 13px;
      color: #888;
      font-weight: 500;
    }
    .status-value {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      color: #333;
    }
    .status-value.connected {
      color: #2e7d32;
    }
    .actions-section {
      margin-bottom: 32px;
    }
    .actions-section h2 {
      font-size: 18px;
      color: #1a1a2e;
      margin: 0 0 16px;
    }
    .action-buttons {
      display: flex;
      gap: 12px;
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
    .btn-secondary {
      background: #e0e0e0;
      color: #333;
    }
    .action-result {
      margin-top: 12px;
      font-size: 13px;
      color: #2e7d32;
    }
    .action-result.error {
      color: #d32f2f;
    }
    .raw-output {
      margin-top: 24px;
    }
    .raw-output h2 {
      font-size: 18px;
      color: #1a1a2e;
      margin: 0 0 12px;
    }
    .raw-output pre {
      background: #1a1a2e;
      color: #e0e0e0;
      padding: 16px;
      border-radius: 8px;
      font-size: 12px;
      overflow-x: auto;
      line-height: 1.5;
    }
  `],
})
export class StatusComponent implements OnInit {
  status: OpenclawStatus | null = null;
  loading = false;
  restarting = false;
  actionMessage = '';
  actionError = false;
  agentCount = '--';

  constructor(private openclaw: OpenclawService) {}

  ngOnInit() {
    this.refresh();
  }

  async refresh() {
    this.loading = true;
    this.actionMessage = '';
    try {
      this.status = await this.openclaw.getStatus();
      // Try to extract agent count from raw output
      const match = this.status.raw.match(/(\d+)\s*agent/i);
      this.agentCount = match ? match[1] : '0';
    } catch {
      this.status = { gateway: false, whatsapp: 'unknown', raw: '' };
    }
    this.loading = false;
  }

  async restartGateway() {
    this.restarting = true;
    this.actionMessage = '';
    this.actionError = false;
    try {
      const result = await this.openclaw.restart();
      if (result.success) {
        this.actionMessage = 'Gateway restarted successfully.';
        setTimeout(() => this.refresh(), 2000);
      } else {
        this.actionMessage = 'Restart failed: ' + (result.error || 'Unknown error');
        this.actionError = true;
      }
    } catch (e: any) {
      this.actionMessage = 'Restart failed: ' + e.message;
      this.actionError = true;
    }
    this.restarting = false;
  }

  viewLogs() {
    // For now, show the raw output. In the future, could open a log viewer.
    if (!this.status?.raw) {
      this.actionMessage = 'No logs available. Try refreshing status first.';
      this.actionError = false;
    }
  }
}
