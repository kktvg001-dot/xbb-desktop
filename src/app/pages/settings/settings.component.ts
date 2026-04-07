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
          <select id="model" [(ngModel)]="settings.model" (ngModelChange)="onModelChange($event)">
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (default)</option>
            <option value="claude-opus-4-6">Claude Opus 4.6</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
            <option value="custom">Custom model...</option>
          </select>
          <input *ngIf="settings.model === 'custom' || isCustomModel"
            type="text"
            [(ngModel)]="customModelId"
            placeholder="e.g. gpt-5.4 or claude-sonnet-4-6"
            class="input-field"
            style="margin-top: 8px;">
          <span class="help-text">Model used for Claude Code sessions</span>
        </div>

        <div class="form-group">
          <label for="workspace">Workspace Path</label>
          <input
            type="text"
            id="workspace"
            [(ngModel)]="settings.workspacePath"
            placeholder="~ (user home directory)"
          />
          <span class="help-text">Working directory for Claude Code (defaults to home dir)</span>
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
      animation: settingsFadeIn 0.4s ease;
    }
    @keyframes settingsFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .settings-page h1 {
      font-size: 24px;
      margin: 0 0 24px;
      color: var(--text-heading);
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .settings-card {
      background: var(--card-bg);
      border-radius: 14px;
      padding: 28px;
      box-shadow: 0 1px 4px var(--card-shadow);
      border: 1px solid var(--border);
    }
    .form-group {
      margin-bottom: 20px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .form-group input,
    .form-group select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--input-border);
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
      background: var(--input-bg);
      color: var(--text-primary);
    }
    .form-group input:focus,
    .form-group select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }
    .masked-input {
      display: flex;
      gap: 8px;
    }
    .masked-input input {
      flex: 1;
    }
    .toggle-btn {
      background: var(--btn-secondary-bg);
      border: none;
      border-radius: 8px;
      padding: 0 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      color: var(--text-secondary);
      white-space: nowrap;
    }
    .toggle-btn:hover {
      opacity: 0.85;
    }
    .help-text {
      display: block;
      font-size: 12px;
      color: var(--text-faint);
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
      background: var(--accent-gradient);
      color: #fff;
    }
    .btn-primary:hover {
      box-shadow: 0 4px 16px var(--accent-glow);
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: var(--btn-secondary-bg);
      color: var(--btn-secondary-text);
    }
    .status-message {
      margin-top: 16px;
      font-size: 13px;
      padding: 10px 14px;
      border-radius: 8px;
    }
    .status-message.success {
      background: var(--success-bg);
      color: var(--success-text);
    }
    .status-message.error {
      background: var(--error-bg);
      color: var(--error-text);
    }
  `],
})
export class SettingsComponent implements OnInit {
  settings: Settings = {
    apiKey: '',
    proxyUrl: '',
    model: 'claude-sonnet-4-6',
    workspacePath: '',
  };

  showApiKey = false;
  testing = false;
  statusMessage = '';
  statusError = false;
  customModelId = '';
  isCustomModel = false;

  onModelChange(value: string) {
    if (value === 'custom') {
      this.isCustomModel = true;
    } else {
      this.isCustomModel = false;
      this.customModelId = '';
    }
  }

  constructor(private claude: ClaudeService) {}

  ngOnInit() {
    this.load();
  }

  async load() {
    try {
      const saved = localStorage.getItem('xbb-settings');
      if (saved) {
        this.settings = { ...this.settings, ...JSON.parse(saved) };
      }
      // Get correct workspace path from Electron (OS-aware)
      if ((window as any).electronAPI) {
        const config = await (window as any).electronAPI.getConfig();
        // Migrate away from .openclaw default
        if (this.settings.workspacePath && this.settings.workspacePath.includes('.openclaw')) {
          this.settings.workspacePath = config.defaultWorkspace || '';
        }
        if (!this.settings.workspacePath) {
          this.settings.workspacePath = config.defaultWorkspace || '';
        }
        if (!this.settings.apiKey) this.settings.apiKey = config.apiKey || '';
        if (!this.settings.proxyUrl) this.settings.proxyUrl = config.apiBaseUrl || '';
      }
      this.settings.workspacePath = this.settings.workspacePath || this.claude.getWorkDir();
      // Check if saved model is custom
      const knownModels = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001', 'custom'];
      if (this.settings.model && !knownModels.includes(this.settings.model)) {
        this.customModelId = this.settings.model;
        this.isCustomModel = true;
        this.settings.model = 'custom';
      }
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
