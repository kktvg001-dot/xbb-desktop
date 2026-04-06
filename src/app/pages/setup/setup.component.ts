import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { InstallerService, AllToolsStatus, ToolStatus } from '../../services/installer.service';

@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="setup-page">
      <div class="setup-card">
        <h1 class="setup-title">Welcome to OpenClaw Assistant</h1>
        <p class="setup-subtitle">Let's make sure everything is installed before we get started.</p>

        <div class="checklist" *ngIf="tools">
          <div class="check-item" *ngFor="let item of toolList">
            <div class="check-icon" [class.installed]="item.installed" [class.installing]="item.installing">
              <span *ngIf="item.installed">&#10003;</span>
              <span *ngIf="!item.installed && !item.installing">&#10007;</span>
              <span *ngIf="item.installing" class="spinner"></span>
            </div>
            <div class="check-info">
              <span class="check-name">{{ item.name }}</span>
              <span class="check-version" *ngIf="item.version">{{ item.version }}</span>
              <span class="check-missing" *ngIf="!item.installed && !item.installing">Not installed</span>
              <span class="check-installing" *ngIf="item.installing">Installing...</span>
            </div>
          </div>
        </div>

        <div class="progress-bar" *ngIf="isInstalling">
          <div class="progress-fill" [style.width.%]="progressPercent"></div>
        </div>

        <div class="setup-actions">
          <button
            class="btn btn-primary"
            *ngIf="!allInstalled && !isInstalling"
            (click)="installAll()"
            [disabled]="checking">
            Install Missing Tools
          </button>
          <button
            class="btn btn-secondary"
            *ngIf="!allInstalled"
            (click)="recheck()"
            [disabled]="checking || isInstalling">
            Re-check
          </button>
          <button
            class="btn btn-success"
            *ngIf="allInstalled"
            (click)="continue()">
            Continue to Chat
          </button>
        </div>

        <p class="error-text" *ngIf="errorMessage">{{ errorMessage }}</p>
      </div>
    </div>
  `,
  styles: [`
    .setup-page {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .setup-card {
      background: #fff;
      border-radius: 12px;
      padding: 40px;
      max-width: 520px;
      width: 100%;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    .setup-title {
      font-size: 24px;
      font-weight: 700;
      margin: 0 0 8px;
      color: #1a1a2e;
    }
    .setup-subtitle {
      color: #666;
      margin: 0 0 28px;
      font-size: 14px;
    }
    .checklist {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-bottom: 28px;
    }
    .check-item {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      background: #f8f9fa;
      border-radius: 8px;
    }
    .check-icon {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: 700;
      background: #fee;
      color: #d32f2f;
      flex-shrink: 0;
    }
    .check-icon.installed {
      background: #e8f5e9;
      color: #2e7d32;
    }
    .check-icon.installing {
      background: #fff3e0;
      color: #ef6c00;
    }
    .check-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .check-name {
      font-weight: 600;
      font-size: 15px;
      color: #1a1a2e;
    }
    .check-version {
      font-size: 12px;
      color: #2e7d32;
    }
    .check-missing {
      font-size: 12px;
      color: #d32f2f;
    }
    .check-installing {
      font-size: 12px;
      color: #ef6c00;
    }
    .progress-bar {
      height: 6px;
      background: #e0e0e0;
      border-radius: 3px;
      margin-bottom: 24px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: #00a884;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .setup-actions {
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
      transition: opacity 0.15s;
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
    .btn-success {
      background: #00a884;
      color: #fff;
    }
    .error-text {
      color: #d32f2f;
      font-size: 13px;
      margin-top: 16px;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #ef6c00;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `],
})
export class SetupComponent implements OnInit {
  tools: AllToolsStatus | null = null;
  toolList: ToolStatus[] = [];
  allInstalled = false;
  checking = true;
  isInstalling = false;
  progressPercent = 0;
  errorMessage = '';

  constructor(
    private installer: InstallerService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.recheck();
  }

  async recheck() {
    this.checking = true;
    this.errorMessage = '';
    try {
      this.tools = await this.installer.checkAll();
      this.toolList = [this.tools.nodejs, this.tools.claude, this.tools.openclaw];
      this.allInstalled = this.toolList.every(t => t.installed);
    } catch (e: any) {
      this.errorMessage = 'Failed to check tools: ' + e.message;
    }
    this.checking = false;
  }

  async installAll() {
    if (!this.tools) return;
    this.isInstalling = true;
    this.errorMessage = '';
    this.progressPercent = 0;

    const toInstall: ('claude' | 'openclaw')[] = [];
    if (!this.tools.claude.installed) toInstall.push('claude');
    if (!this.tools.openclaw.installed) toInstall.push('openclaw');

    if (toInstall.length === 0 && !this.tools.nodejs.installed) {
      this.errorMessage = 'Node.js must be installed manually. Visit https://nodejs.org';
      this.isInstalling = false;
      return;
    }

    let completed = 0;
    for (const tool of toInstall) {
      const key = tool as keyof AllToolsStatus;
      (this.tools[key] as ToolStatus).installing = true;
      this.toolList = [this.tools.nodejs, this.tools.claude, this.tools.openclaw];

      const result = await this.installer.install(tool);

      (this.tools[key] as ToolStatus).installing = false;
      if (result.success) {
        (this.tools[key] as ToolStatus).installed = true;
      } else {
        this.errorMessage = `Failed to install ${tool}: ${result.error || result.output}`;
      }

      completed++;
      this.progressPercent = (completed / toInstall.length) * 100;
      this.toolList = [this.tools.nodejs, this.tools.claude, this.tools.openclaw];
    }

    this.allInstalled = this.toolList.every(t => t.installed);
    this.isInstalling = false;
  }

  continue() {
    this.router.navigate(['/chat']);
  }
}
