import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClaudeService } from '../../services/claude.service';

interface Settings {
  apiKey: string;
  proxyUrl: string;
  model: string;
  workspacePath: string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="settings-page">
      <h1>Settings</h1>

      <div class="settings-card">
        <div class="form-group">
          <label for="apiKey">API Key</label>
          <div class="masked-input">
            <input
              [type]="showApiKey ? 'text' : 'password'"
              id="apiKey"
              [(ngModel)]="settings.apiKey"
              placeholder="sk-ant-..."
            />
            <button class="toggle-btn" (click)="showApiKey = !showApiKey">
              {{ showApiKey ? 'Hide' : 'Show' }}
            </button>
          </div>
          <span class="help-text">Your Anthropic API key or proxy key</span>
        </div>

        <div class="form-group">
          <label for="proxyUrl">Proxy URL</label>
          <input
            type="text"
            id="proxyUrl"
            [(ngModel)]="settings.proxyUrl"
            placeholder="https://api.anthropic.com"
          />
          <span class="help-text">Custom API endpoint (leave blank for default)</span>
        </div>

        <div class="form-group">
          <label for="model">Model</label>
          <select id="model" [(ngModel)]="settings.model">
            <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
            <option value="claude-opus-4-20250514">Claude Opus 4</option>
            <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
            <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
          </select>
          <span class="help-text">Model used for Claude Code sessions</span>
        </div>

        <div class="form-group">
          <label for="workspace">Workspace Path</label>
          <input
            type="text"
            id="workspace"
            [(ngModel)]="settings.workspacePath"
            placeholder="/home/user/.openclaw"
          />
          <span class="help-text">Working directory for Claude Code operations</span>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary" (click)="save()">Save</button>
          <button class="btn btn-secondary" (click)="testConnection()" [disabled]="testing">
            {{ testing ? 'Testing...' : 'Test Connection' }}
          </button>
        </div>

        <p class="status-message" *ngIf="statusMessage" [class.error]="statusError" [class.success]="!statusError">
          {{ statusMessage }}
        </p>
      </div>
    </div>
  `,
  styles: [`
    .settings-page {
      padding: 32px;
      max-width: 600px;
    }
    .settings-page h1 {
      font-size: 24px;
      margin: 0 0 24px;
      color: #1a1a2e;
    }
    .settings-card {
      background: #fff;
      border-radius: 12px;
      padding: 28px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .form-group {
      margin-bottom: 20px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #555;
      margin-bottom: 6px;
    }
    .form-group input,
    .form-group select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
    }
    .form-group input:focus,
    .form-group select:focus {
      border-color: #00a884;
    }
    .masked-input {
      display: flex;
      gap: 8px;
    }
    .masked-input input {
      flex: 1;
    }
    .toggle-btn {
      background: #e0e0e0;
      border: none;
      border-radius: 8px;
      padding: 0 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      color: #555;
      white-space: nowrap;
    }
    .toggle-btn:hover {
      background: #d0d0d0;
    }
    .help-text {
      display: block;
      font-size: 12px;
      color: #999;
      margin-top: 4px;
    }
    .form-actions {
      display: flex;
      gap: 12px;
      margin-top: 28px;
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
    .btn-primary:hover {
      background: #009674;
    }
    .btn-secondary {
      background: #e0e0e0;
      color: #333;
    }
    .status-message {
      margin-top: 16px;
      font-size: 13px;
      padding: 10px 14px;
      border-radius: 8px;
    }
    .status-message.success {
      background: #e8f5e9;
      color: #2e7d32;
    }
    .status-message.error {
      background: #fce4ec;
      color: #c62828;
    }
  `],
})
export class SettingsComponent implements OnInit {
  settings: Settings = {
    apiKey: '',
    proxyUrl: '',
    model: 'claude-sonnet-4-20250514',
    workspacePath: '',
  };

  showApiKey = false;
  testing = false;
  statusMessage = '';
  statusError = false;

  constructor(private claude: ClaudeService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    try {
      const saved = localStorage.getItem('xbb-settings');
      if (saved) {
        this.settings = { ...this.settings, ...JSON.parse(saved) };
      }
      this.settings.workspacePath = this.settings.workspacePath || this.claude.getWorkDir();
    } catch {}
  }

  save() {
    try {
      localStorage.setItem('xbb-settings', JSON.stringify(this.settings));
      if (this.settings.workspacePath) {
        this.claude.setWorkDir(this.settings.workspacePath);
      }
      this.statusMessage = 'Settings saved successfully.';
      this.statusError = false;
    } catch (e: any) {
      this.statusMessage = 'Failed to save: ' + e.message;
      this.statusError = true;
    }
  }

  async testConnection() {
    this.testing = true;
    this.statusMessage = '';
    try {
      const result = await window.electronAPI.checkTool('claude');
      if (result.installed) {
        this.statusMessage = `Claude Code is installed (${result.version}). Connection test passed.`;
        this.statusError = false;
      } else {
        this.statusMessage = 'Claude Code is not installed. Go to Setup to install it.';
        this.statusError = true;
      }
    } catch (e: any) {
      this.statusMessage = 'Connection test failed: ' + e.message;
      this.statusError = true;
    }
    this.testing = false;
  }
}
