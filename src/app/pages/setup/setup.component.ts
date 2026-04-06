import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { InstallerService, AllToolsStatus } from '../../services/installer.service';

type WizardStep = 1 | 2 | 3 | 4;

@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="setup-fullscreen">
      <!-- Browser mode fallback -->
      <div class="setup-card" *ngIf="browserMode">
        <div class="step-icon">&#128187;</div>
        <h1 class="step-title">Desktop App Required</h1>
        <p class="step-desc">Running in browser mode. Install features require the desktop app.</p>
        <p class="step-detail">Download the desktop version to continue setup.</p>
      </div>

      <!-- Wizard -->
      <div class="setup-card" *ngIf="!browserMode" [class.animate-in]="animateIn">
        <!-- Overall progress header -->
        <div class="progress-header">
          <span class="progress-label">Step {{ currentStep }} of 4</span>
          <span class="progress-pct">{{ overallPercent }}%</span>
        </div>
        <div class="overall-progress-bar">
          <div class="overall-progress-fill" [style.width.%]="overallPercent"></div>
        </div>

        <!-- Step 1: Welcome -->
        <div class="step" *ngIf="currentStep === 1">
          <div class="step-icon">&#127881;</div>
          <h1 class="step-title">Welcome!</h1>
          <p class="step-desc">Let's set up your AI assistant.</p>
          <p class="step-detail">This will take about 2 minutes.</p>
          <div class="step-actions center">
            <button class="btn btn-primary btn-large" (click)="startSetup()">
              Get Started <span class="arrow">&#8594;</span>
            </button>
          </div>
        </div>

        <!-- Step 2: Install AI Engine (Node.js + Claude Code) -->
        <div class="step" *ngIf="currentStep === 2">
          <div class="step-icon">&#9881;</div>
          <h1 class="step-title">Installing AI Engine</h1>
          <p class="step-desc">{{ stepActionText }}</p>

          <div class="step-progress-bar" *ngIf="stepStatus === 'installing'">
            <div class="step-progress-fill" [style.width.%]="stepProgress"></div>
          </div>
          <div class="step-progress-text" *ngIf="stepStatus === 'installing'">{{ stepProgress }}%</div>

          <div class="log-box" *ngIf="logOutput" #logBox>
            <pre>{{ logOutput }}</pre>
          </div>

          <div class="status-badge success" *ngIf="stepStatus === 'done'">
            <span>&#10003;</span> AI Engine ready!
          </div>
          <div class="status-badge error" *ngIf="stepStatus === 'error'">
            <span>&#10007;</span> Installation failed
          </div>

          <div class="step-actions center">
            <button class="btn btn-primary" *ngIf="stepStatus === 'error'" (click)="runStep2()">
              Retry
            </button>
          </div>
        </div>

        <!-- Step 3: Install OpenClaw -->
        <div class="step" *ngIf="currentStep === 3">
          <div class="step-icon">&#128241;</div>
          <h1 class="step-title">Installing OpenClaw</h1>
          <p class="step-desc">{{ stepActionText }}</p>

          <div class="step-progress-bar" *ngIf="stepStatus === 'installing'">
            <div class="step-progress-fill" [style.width.%]="stepProgress"></div>
          </div>
          <div class="step-progress-text" *ngIf="stepStatus === 'installing'">{{ stepProgress }}%</div>

          <div class="log-box" *ngIf="logOutput" #logBox>
            <pre>{{ logOutput }}</pre>
          </div>

          <div class="status-badge success" *ngIf="stepStatus === 'done'">
            <span>&#10003;</span> OpenClaw ready!
          </div>
          <div class="status-badge error" *ngIf="stepStatus === 'error'">
            <span>&#10007;</span> Installation failed
          </div>

          <div class="step-actions center">
            <button class="btn btn-primary" *ngIf="stepStatus === 'error'" (click)="runStep3()">
              Retry
            </button>
          </div>
        </div>

        <!-- Step 4: Ready -->
        <div class="step" *ngIf="currentStep === 4">
          <div class="step-icon large">&#127881;</div>
          <h1 class="step-title">You're All Set!</h1>
          <p class="step-desc">Your AI assistant is ready to help.</p>

          <div class="config-list">
            <div class="config-item" *ngIf="tools?.claude">
              <span class="config-label">
                <span class="check-mark" *ngIf="tools?.claude?.installed">&#10003;</span>
                <span class="x-mark" *ngIf="!tools?.claude?.installed">&#10007;</span>
                Claude Code
              </span>
              <span class="config-value">{{ tools?.claude?.version || 'n/a' }}</span>
            </div>
            <div class="config-item" *ngIf="tools?.openclaw">
              <span class="config-label">
                <span class="check-mark" *ngIf="tools?.openclaw?.installed">&#10003;</span>
                <span class="x-mark" *ngIf="!tools?.openclaw?.installed">&#10007;</span>
                OpenClaw
              </span>
              <span class="config-value">{{ tools?.openclaw?.version || 'n/a' }}</span>
            </div>
          </div>

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
    .setup-fullscreen {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      width: 100%;
      padding: 24px;
      background: linear-gradient(135deg, #f5f7fa 0%, #e4e9f0 100%);
    }
    .setup-card {
      background: #fff;
      border-radius: 16px;
      padding: 40px 40px 36px;
      max-width: 580px;
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

    /* Overall progress header */
    .progress-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .progress-label {
      font-size: 13px;
      font-weight: 600;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .progress-pct {
      font-size: 13px;
      font-weight: 600;
      color: #00a884;
    }
    .overall-progress-bar {
      height: 8px;
      background: #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 32px;
    }
    .overall-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #00a884, #00c49a);
      border-radius: 4px;
      transition: width 0.5s ease;
    }

    /* Step content */
    .step {
      text-align: center;
    }
    .step-icon {
      font-size: 48px;
      margin-bottom: 12px;
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
    .step-detail {
      color: #999;
      font-size: 13px;
      margin: 0 0 28px;
    }

    /* Per-step progress bar */
    .step-progress-bar {
      height: 10px;
      background: #e0e0e0;
      border-radius: 5px;
      margin: 20px 0 6px;
      overflow: hidden;
    }
    .step-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #00a884, #00c49a);
      border-radius: 5px;
      transition: width 0.4s ease;
    }
    .step-progress-text {
      font-size: 13px;
      font-weight: 600;
      color: #00a884;
      text-align: right;
      margin-bottom: 12px;
    }

    /* Log output */
    .log-box {
      background: #1a1a2e;
      border-radius: 8px;
      padding: 14px 16px;
      margin: 16px 0;
      max-height: 200px;
      overflow-y: auto;
      text-align: left;
    }
    .log-box pre {
      margin: 0;
      font-size: 12px;
      color: #a0e0c0;
      font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.5;
    }

    /* Status badges */
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      margin: 16px 0;
    }
    .status-badge.success {
      background: #e8f5e9;
      color: #2e7d32;
    }
    .status-badge.error {
      background: #fbe9e7;
      color: #d32f2f;
    }

    /* Config list (ready step) */
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
      font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
    }
    .check-mark { color: #2e7d32; font-weight: 700; }
    .x-mark { color: #d32f2f; font-weight: 700; }

    /* Actions */
    .step-actions {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin-top: 24px;
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
  `],
})
export class SetupComponent implements OnInit, OnDestroy {
  currentStep: WizardStep = 1;
  animateIn = true;
  browserMode = false;

  tools: AllToolsStatus | null = null;
  errorMessage = '';

  // Per-step state
  stepStatus: 'idle' | 'installing' | 'done' | 'error' = 'idle';
  stepProgress = 0;
  stepActionText = '';
  logOutput = '';

  @ViewChild('logBox') logBox?: ElementRef;

  get overallPercent(): number {
    return Math.round(((this.currentStep - 1) / 4) * 100);
  }

  constructor(
    private installer: InstallerService,
    private router: Router,
  ) {}

  ngOnInit() {
    if (!this.installer.isElectron) {
      this.browserMode = true;
      this.errorMessage = 'Running in browser mode. Install features require the desktop app.';
      return;
    }
    this.checkTools();
    this.installer.onInstallProgress((data: any) => {
      if (data.tool === 'nodejs' || data.tool === 'claude') {
        this.logOutput += data.output;
        if (data.tool === 'nodejs') {
          this.stepProgress = Math.min(this.stepProgress + 5, 45);
        } else {
          this.stepProgress = Math.min(this.stepProgress + 8, 90);
        }
      }
      if (data.tool === 'openclaw') {
        this.logOutput += data.output;
        this.stepProgress = Math.min(this.stepProgress + 10, 90);
      }
      this.scrollLogToBottom();
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

  private goToStep(step: WizardStep) {
    this.animateIn = false;
    setTimeout(() => {
      this.currentStep = step;
      this.stepStatus = 'idle';
      this.stepProgress = 0;
      this.stepActionText = '';
      this.logOutput = '';
      this.errorMessage = '';
      this.animateIn = true;
    }, 50);
  }

  private scrollLogToBottom() {
    setTimeout(() => {
      if (this.logBox?.nativeElement) {
        this.logBox.nativeElement.scrollTop = this.logBox.nativeElement.scrollHeight;
      }
    }, 50);
  }

  async startSetup() {
    await this.checkTools();
    this.goToStep(2);
    setTimeout(() => this.runStep2(), 200);
  }

  async runStep2() {
    this.stepStatus = 'installing';
    this.stepProgress = 0;
    this.logOutput = '';
    this.errorMessage = '';

    try {
      // Phase 1: Node.js
      if (this.tools?.nodejs?.installed) {
        this.stepActionText = 'Node.js already installed.';
        this.logOutput += 'Node.js ' + (this.tools.nodejs.version || '') + ' found.\n';
        this.stepProgress = 45;
      } else {
        this.stepActionText = 'Downloading Node.js...';
        const nodeResult = await this.installer.installNodejs();
        if (!nodeResult.success) {
          this.stepStatus = 'error';
          this.stepActionText = 'Node.js installation failed.';
          this.logOutput += '\n' + (nodeResult.output || 'Unknown error');
          return;
        }
        this.stepProgress = 45;
        this.logOutput += '\nNode.js installed successfully.\n';
      }

      // Phase 2: Claude Code
      if (this.tools?.claude?.installed) {
        this.stepActionText = 'Claude Code already installed.';
        this.logOutput += 'Claude Code ' + (this.tools.claude.version || '') + ' found.\n';
        this.stepProgress = 100;
        this.stepStatus = 'done';
      } else {
        this.stepActionText = 'Installing Claude Code...';
        const claudeResult = await this.installer.installClaude();
        if (!claudeResult.success) {
          this.stepStatus = 'error';
          this.stepActionText = 'Claude Code installation failed.';
          this.logOutput += '\n' + (claudeResult.output || 'Unknown error');
          return;
        }
        this.stepProgress = 100;
        this.stepStatus = 'done';
        this.logOutput += '\nClaude Code installed successfully.\n';
      }

      this.stepActionText = 'AI Engine is ready!';
      await this.checkTools();

      // Auto-advance after 1.5s
      setTimeout(() => {
        this.goToStep(3);
        setTimeout(() => this.runStep3(), 200);
      }, 1500);

    } catch (e: any) {
      this.stepStatus = 'error';
      this.stepActionText = 'Installation failed.';
      this.errorMessage = e.message;
    }
  }

  async runStep3() {
    this.stepStatus = 'installing';
    this.stepProgress = 0;
    this.logOutput = '';
    this.errorMessage = '';

    try {
      if (this.tools?.openclaw?.installed) {
        this.stepActionText = 'OpenClaw already installed.';
        this.logOutput += 'OpenClaw ' + (this.tools.openclaw.version || '') + ' found.\n';
        this.stepProgress = 100;
        this.stepStatus = 'done';
      } else {
        this.stepActionText = 'Setting up OpenClaw...';
        const result = await this.installer.installOpenclaw();
        if (!result.success) {
          this.stepStatus = 'error';
          this.stepActionText = 'OpenClaw installation failed.';
          this.logOutput += '\n' + (result.output || 'Unknown error');
          return;
        }
        this.stepProgress = 100;
        this.stepStatus = 'done';
        this.logOutput += '\nOpenClaw installed successfully.\n';
      }

      this.stepActionText = 'OpenClaw is ready!';
      await this.checkTools();

      // Auto-advance after 1.5s
      setTimeout(() => this.goToStep(4), 1500);

    } catch (e: any) {
      this.stepStatus = 'error';
      this.stepActionText = 'Installation failed.';
      this.errorMessage = e.message;
    }
  }

  startChatting() {
    this.router.navigate(['/chat']);
  }
}
