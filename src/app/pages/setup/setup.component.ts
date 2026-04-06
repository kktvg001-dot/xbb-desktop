import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { InstallerService, AllToolsStatus, ToolStatus } from '../../services/installer.service';

type SetupStep = 'welcome' | 'claude' | 'openclaw' | 'configure' | 'ready';

@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="setup-page">
      <div class="setup-card" [class.animate-in]="animateIn">

        <!-- Step indicators -->
        <div class="step-dots">
          <div class="dot" *ngFor="let s of steps; let i = index"
               [class.active]="i === currentStepIndex"
               [class.done]="i < currentStepIndex">
          </div>
        </div>

        <!-- Step 1: Welcome -->
        <div class="step" *ngIf="currentStep === 'welcome'">
          <div class="step-icon">&#127881;</div>
          <h1 class="step-title">Welcome to OpenClaw Assistant!</h1>
          <p class="step-desc">Let's get you set up in 2 minutes.</p>
          <p class="step-detail">We'll install the AI engine and WhatsApp gateway, then you're ready to chat.</p>
          <div class="step-actions">
            <button class="btn btn-primary btn-large" (click)="startSetup()">
              Get Started <span class="arrow">&#8594;</span>
            </button>
          </div>
        </div>

        <!-- Step 2: Install Claude Code -->
        <div class="step" *ngIf="currentStep === 'claude'">
          <div class="step-icon">&#9881;</div>
          <h1 class="step-title">Installing AI Engine</h1>
          <p class="step-desc" *ngIf="claudeStatus === 'installing'">Downloading and installing Claude Code...</p>
          <p class="step-desc success" *ngIf="claudeStatus === 'done'">Claude Code installed successfully!</p>
          <p class="step-desc error" *ngIf="claudeStatus === 'error'">Installation failed. Check the log below.</p>
          <p class="step-desc" *ngIf="claudeStatus === 'skipped'">Claude Code is already installed!</p>

          <div class="progress-bar" *ngIf="claudeStatus === 'installing'">
            <div class="progress-fill" [style.width.%]="claudeProgress"></div>
          </div>

          <div class="log-output" *ngIf="claudeLog">
            <pre>{{ claudeLog }}</pre>
          </div>

          <div class="tool-version" *ngIf="tools?.claude?.version && (claudeStatus === 'done' || claudeStatus === 'skipped')">
            <span class="check-mark">&#10003;</span> Claude Code {{ tools?.claude?.version }}
          </div>

          <div class="step-actions">
            <button class="btn btn-secondary" (click)="goToStep('welcome')" [disabled]="claudeStatus === 'installing'">
              <span class="arrow">&#8592;</span> Back
            </button>
            <button class="btn btn-primary" *ngIf="claudeStatus === 'error'" (click)="installClaude()">
              Retry
            </button>
            <button class="btn btn-primary" *ngIf="claudeStatus === 'done' || claudeStatus === 'skipped'" (click)="goToOpenclawStep()">
              Next <span class="arrow">&#8594;</span>
            </button>
          </div>
        </div>

        <!-- Step 3: Install OpenClaw -->
        <div class="step" *ngIf="currentStep === 'openclaw'">
          <div class="step-icon">&#128241;</div>
          <h1 class="step-title">Installing WhatsApp Gateway</h1>
          <p class="step-desc" *ngIf="openclawStatus === 'installing'">Setting up OpenClaw...</p>
          <p class="step-desc success" *ngIf="openclawStatus === 'done'">OpenClaw installed successfully!</p>
          <p class="step-desc error" *ngIf="openclawStatus === 'error'">Installation failed. Check the log below.</p>
          <p class="step-desc" *ngIf="openclawStatus === 'skipped'">OpenClaw is already installed!</p>

          <div class="progress-bar" *ngIf="openclawStatus === 'installing'">
            <div class="progress-fill" [style.width.%]="openclawProgress"></div>
          </div>

          <div class="log-output" *ngIf="openclawLog">
            <pre>{{ openclawLog }}</pre>
          </div>

          <div class="tool-version" *ngIf="tools?.openclaw?.version && (openclawStatus === 'done' || openclawStatus === 'skipped')">
            <span class="check-mark">&#10003;</span> OpenClaw {{ tools?.openclaw?.version }}
          </div>

          <div class="step-actions">
            <button class="btn btn-secondary" (click)="goToStep('claude')" [disabled]="openclawStatus === 'installing'">
              <span class="arrow">&#8592;</span> Back
            </button>
            <button class="btn btn-primary" *ngIf="openclawStatus === 'error'" (click)="installOpenclaw()">
              Retry
            </button>
            <button class="btn btn-primary" *ngIf="openclawStatus === 'done' || openclawStatus === 'skipped'" (click)="goToStep('configure')">
              Next <span class="arrow">&#8594;</span>
            </button>
          </div>
        </div>

        <!-- Step 4: Configure -->
        <div class="step" *ngIf="currentStep === 'configure'">
          <div class="step-icon">&#128295;</div>
          <h1 class="step-title">Almost Done!</h1>
          <p class="step-desc">Let's verify your installation.</p>

          <div class="config-list">
            <div class="config-item">
              <span class="config-label">Workspace</span>
              <span class="config-value">~/.openclaw/</span>
            </div>
            <div class="config-item" *ngIf="tools?.claude">
              <span class="config-label">
                <span class="check-mark" *ngIf="tools?.claude?.installed">&#10003;</span>
                <span class="x-mark" *ngIf="!tools?.claude?.installed">&#10007;</span>
                Claude Code
              </span>
              <span class="config-value">{{ tools?.claude?.version || 'not found' }}</span>
            </div>
            <div class="config-item" *ngIf="tools?.openclaw">
              <span class="config-label">
                <span class="check-mark" *ngIf="tools?.openclaw?.installed">&#10003;</span>
                <span class="x-mark" *ngIf="!tools?.openclaw?.installed">&#10007;</span>
                OpenClaw
              </span>
              <span class="config-value">{{ tools?.openclaw?.version || 'not found' }}</span>
            </div>
          </div>

          <div class="step-actions">
            <button class="btn btn-secondary" (click)="goToStep('openclaw')">
              <span class="arrow">&#8592;</span> Back
            </button>
            <button class="btn btn-secondary" (click)="recheckTools()">
              Re-check
            </button>
            <button class="btn btn-primary" (click)="goToStep('ready')">
              Next <span class="arrow">&#8594;</span>
            </button>
          </div>
        </div>

        <!-- Step 5: Ready -->
        <div class="step" *ngIf="currentStep === 'ready'">
          <div class="step-icon large">&#127881;</div>
          <h1 class="step-title">You're All Set!</h1>
          <p class="step-desc">Your AI assistant is ready to help.</p>
          <div class="step-actions center">
            <button class="btn btn-success btn-large" (click)="startChatting()">
              Start Chatting <span class="arrow">&#8594;</span>
            </button>
          </div>
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
      background: linear-gradient(135deg, #f5f7fa 0%, #e4e9f0 100%);
    }
    .setup-card {
      background: #fff;
      border-radius: 16px;
      padding: 48px 40px 40px;
      max-width: 560px;
      width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      transition: opacity 0.3s ease, transform 0.3s ease;
    }
    .setup-card.animate-in {
      animation: slideIn 0.3s ease forwards;
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Step dots */
    .step-dots {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 32px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #e0e0e0;
      transition: all 0.3s ease;
    }
    .dot.active {
      background: #00a884;
      transform: scale(1.2);
    }
    .dot.done {
      background: #00a884;
      opacity: 0.5;
    }

    /* Step content */
    .step {
      text-align: center;
    }
    .step-icon {
      font-size: 48px;
      margin-bottom: 16px;
      line-height: 1;
    }
    .step-icon.large {
      font-size: 64px;
    }
    .step-title {
      font-size: 24px;
      font-weight: 700;
      margin: 0 0 8px;
      color: #1a1a2e;
    }
    .step-desc {
      color: #666;
      margin: 0 0 8px;
      font-size: 15px;
    }
    .step-desc.success {
      color: #2e7d32;
    }
    .step-desc.error {
      color: #d32f2f;
    }
    .step-detail {
      color: #999;
      font-size: 13px;
      margin: 0 0 32px;
    }

    /* Progress bar */
    .progress-bar {
      height: 6px;
      background: #e0e0e0;
      border-radius: 3px;
      margin: 20px 0;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: #00a884;
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    /* Log output */
    .log-output {
      background: #1a1a2e;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
      max-height: 160px;
      overflow-y: auto;
      text-align: left;
    }
    .log-output pre {
      margin: 0;
      font-size: 12px;
      color: #a0e0c0;
      font-family: 'SF Mono', 'Fira Code', monospace;
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* Tool version badge */
    .tool-version {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: #e8f5e9;
      border-radius: 8px;
      color: #2e7d32;
      font-size: 14px;
      font-weight: 600;
      margin: 16px 0;
    }
    .check-mark {
      color: #2e7d32;
      font-weight: 700;
    }
    .x-mark {
      color: #d32f2f;
      font-weight: 700;
    }

    /* Config list */
    .config-list {
      text-align: left;
      margin: 24px 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .config-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 16px;
      background: #f8f9fa;
      border-radius: 8px;
    }
    .config-label {
      font-weight: 600;
      font-size: 14px;
      color: #1a1a2e;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .config-value {
      font-size: 13px;
      color: #666;
      font-family: 'SF Mono', 'Fira Code', monospace;
    }

    /* Actions */
    .step-actions {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin-top: 28px;
    }
    .step-actions.center {
      justify-content: center;
    }
    .btn {
      padding: 10px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
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
    .btn-large {
      padding: 14px 36px;
      font-size: 16px;
    }
    .arrow {
      font-size: 16px;
    }
    .error-text {
      color: #d32f2f;
      font-size: 13px;
      margin-top: 16px;
      text-align: center;
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
export class SetupComponent implements OnInit, OnDestroy {
  steps: SetupStep[] = ['welcome', 'claude', 'openclaw', 'configure', 'ready'];
  currentStep: SetupStep = 'welcome';
  currentStepIndex = 0;
  animateIn = true;

  tools: AllToolsStatus | null = null;
  errorMessage = '';

  // Claude install state
  claudeStatus: 'pending' | 'installing' | 'done' | 'skipped' | 'error' = 'pending';
  claudeProgress = 0;
  claudeLog = '';

  // OpenClaw install state
  openclawStatus: 'pending' | 'installing' | 'done' | 'skipped' | 'error' = 'pending';
  openclawProgress = 0;
  openclawLog = '';

  constructor(
    private installer: InstallerService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.checkTools();
    this.installer.onInstallProgress((data: any) => {
      if (data.tool === 'claude') {
        this.claudeLog += data.output;
        this.claudeProgress = Math.min(this.claudeProgress + 8, 90);
      }
      if (data.tool === 'openclaw') {
        this.openclawLog += data.output;
        this.openclawProgress = Math.min(this.openclawProgress + 10, 90);
      }
    });
  }

  ngOnDestroy() {
    this.installer.removeInstallProgressListeners();
  }

  async checkTools() {
    try {
      this.tools = await this.installer.checkAll();
    } catch (e: any) {
      this.errorMessage = 'Failed to check tools: ' + e.message;
    }
  }

  async recheckTools() {
    this.errorMessage = '';
    await this.checkTools();
  }

  goToStep(step: SetupStep) {
    this.animateIn = false;
    setTimeout(() => {
      this.currentStep = step;
      this.currentStepIndex = this.steps.indexOf(step);
      this.animateIn = true;
    }, 50);
  }

  async startSetup() {
    // Check tools first
    await this.checkTools();

    // Go to Claude step
    this.goToStep('claude');

    // Auto-start install if not already installed
    setTimeout(() => {
      if (this.tools?.claude?.installed) {
        this.claudeStatus = 'skipped';
      } else {
        this.installClaude();
      }
    }, 200);
  }

  async installClaude() {
    this.claudeStatus = 'installing';
    this.claudeProgress = 10;
    this.claudeLog = '';
    this.errorMessage = '';

    try {
      const result = await this.installer.installClaude();
      if (result.success) {
        this.claudeProgress = 100;
        this.claudeStatus = 'done';
        // Re-check to get version
        await this.checkTools();
      } else {
        this.claudeStatus = 'error';
        this.claudeLog += '\n' + (result.output || 'Unknown error');
      }
    } catch (e: any) {
      this.claudeStatus = 'error';
      this.errorMessage = 'Install failed: ' + e.message;
    }
  }

  async installOpenclaw() {
    this.openclawStatus = 'installing';
    this.openclawProgress = 10;
    this.openclawLog = '';
    this.errorMessage = '';

    try {
      const result = await this.installer.installOpenclaw();
      if (result.success) {
        this.openclawProgress = 100;
        this.openclawStatus = 'done';
        await this.checkTools();
      } else {
        this.openclawStatus = 'error';
        this.openclawLog += '\n' + (result.output || 'Unknown error');
      }
    } catch (e: any) {
      this.openclawStatus = 'error';
      this.errorMessage = 'Install failed: ' + e.message;
    }
  }

  // Called when navigating to openclaw step
  goToOpenclawStep() {
    this.goToStep('openclaw');
    setTimeout(() => {
      if (this.tools?.openclaw?.installed) {
        this.openclawStatus = 'skipped';
      } else {
        this.installOpenclaw();
      }
    }, 200);
  }

  startChatting() {
    this.router.navigate(['/chat']);
  }
}
