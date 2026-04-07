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
      <div class="setup-card" [class.animate-in]="animateIn">
        <!-- Progress header -->
        <div class="progress-header">
          <div class="progress-bar-track">
            <div class="progress-bar-fill" [style.width.%]="overallPercent"></div>
          </div>
          <span class="progress-text">Step {{ currentStep }} of 4</span>
        </div>

        <!-- Step 1: Welcome -->
        <div class="step" *ngIf="currentStep === 1">
          <h1 class="step-title" style="font-size:32px; margin-bottom:8px;">OpenClaw Assistant</h1>
          <p class="step-desc">Let's set up your AI assistant in under 2 minutes.</p>
          <div class="step-actions">
            <button class="btn btn-primary btn-full" (click)="startSetup()" [disabled]="isStarting">
              {{ isStarting ? 'Checking your system...' : 'Get Started' }}
            </button>
          </div>
        </div>

        <!-- Step 2: Install AI Engine -->
        <div class="step" *ngIf="currentStep === 2">
          <div class="step-header-row">
            <span class="tool-icon">&#9881;&#65039;</span>
            <h1 class="step-title inline">AI Engine</h1>
          </div>
          <div class="preview-badge" *ngIf="browserMode">Preview — requires desktop app</div>
          <p class="step-desc status-text">
            <span *ngIf="stepStatus === 'installing'">Installing...</span>
            <span *ngIf="stepStatus === 'done'" class="status-ok">&#10004; Installed</span>
            <span *ngIf="stepStatus === 'error'" class="status-err">&#10008; Failed</span>
            <span *ngIf="stepStatus === 'idle'">{{ stepActionText }}</span>
          </p>

          <div class="install-progress-bar" *ngIf="stepStatus === 'installing'">
            <div class="install-progress-fill" [style.width.%]="stepProgress"></div>
          </div>

          <div class="log-box" *ngIf="logOutput" #logBox>
            <pre>{{ logOutput }}</pre>
          </div>

          <div class="step-actions">
            <button class="btn btn-primary btn-full" *ngIf="stepStatus === 'done' || stepStatus === 'idle'" (click)="goToStep(3)">
              Continue →
            </button>
            <button class="btn btn-primary btn-full" *ngIf="stepStatus === 'error'" (click)="runStep2()"
              [attr.title]="browserMode ? 'Requires desktop app' : null">
              Retry
            </button>
          </div>
        </div>

        <!-- Step 3: Install OpenClaw -->
        <div class="step" *ngIf="currentStep === 3">
          <div class="step-header-row">
            <span class="tool-icon">&#128241;</span>
            <h1 class="step-title inline">OpenClaw</h1>
          </div>
          <div class="preview-badge" *ngIf="browserMode">Preview — requires desktop app</div>
          <p class="step-desc status-text">
            <span *ngIf="stepStatus === 'installing'">Installing...</span>
            <span *ngIf="stepStatus === 'done'" class="status-ok">&#10004; Installed</span>
            <span *ngIf="stepStatus === 'error'" class="status-err">&#10008; Failed</span>
            <span *ngIf="stepStatus === 'idle'">Checking...</span>
          </p>

          <div class="install-progress-bar" *ngIf="stepStatus === 'installing'">
            <div class="install-progress-fill" [style.width.%]="stepProgress"></div>
          </div>

          <div class="log-box" *ngIf="logOutput" #logBox>
            <pre>{{ logOutput }}</pre>
          </div>

          <div class="step-actions">
            <button class="btn btn-primary btn-full" *ngIf="stepStatus === 'done' || stepStatus === 'idle'" (click)="goToStep(4)">
              Continue →
            </button>
            <button class="btn btn-primary btn-full" *ngIf="stepStatus === 'error'" (click)="runStep3()"
              [attr.title]="browserMode ? 'Requires desktop app' : null">
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
            <div class="config-item" *ngIf="tools?.claude || browserMode">
              <span class="config-label">
                <span class="check-icon">&#10004;</span>
                Claude Code
              </span>
              <span class="config-value">{{ tools?.claude?.version || (browserMode ? 'v1.0.x' : 'n/a') }}</span>
            </div>
            <div class="config-item" *ngIf="tools?.openclaw || browserMode">
              <span class="config-label">
                <span class="check-icon">&#10004;</span>
                OpenClaw
              </span>
              <span class="config-value">{{ tools?.openclaw?.version || (browserMode ? 'v2.4.x' : 'n/a') }}</span>
            </div>
          </div>

          <div class="step-actions">
            <button class="btn btn-primary btn-full" (click)="startChatting()">
              Open Dashboard <span class="arrow">&rarr;</span>
            </button>
          </div>
        </div>

        <p class="error-text" *ngIf="errorMessage">{{ errorMessage }}</p>
      </div>
    </div>
  `,
  styles: [`
    /* ========== Layout ========== */
    .setup-fullscreen {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      width: 100%;
      padding: 24px;
      background: linear-gradient(160deg, #f0f4f8 0%, #e2e8f0 50%, #dfe6ed 100%);
    }

    .setup-card {
      background: #fff;
      border-radius: 20px;
      padding: 44px 44px 40px;
      max-width: 500px;
      width: 100%;
      box-shadow:
        0 1px 3px rgba(0,0,0,0.04),
        0 8px 32px rgba(0,0,0,0.08);
      opacity: 0;
      transform: translateY(16px);
    }
    .setup-card.animate-in {
      animation: cardIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    }
    @keyframes cardIn {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ========== Progress Header ========== */
    .progress-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 36px;
    }
    .progress-bar-track {
      flex: 1;
      height: 6px;
      background: #e8ecf0;
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #00a884, #00c49a);
      border-radius: 3px;
      transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .progress-text {
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      white-space: nowrap;
    }

    /* ========== Step Content ========== */
    .step {
      text-align: center;
    }
    .step-icon {
      font-size: 52px;
      margin-bottom: 8px;
      line-height: 1;
    }
    .step-icon.large {
      font-size: 64px;
    }
    .step-title {
      font-size: 28px;
      font-weight: 700;
      margin: 0 0 10px;
      color: #1e293b;
      letter-spacing: -0.3px;
    }
    .step-title.inline {
      display: inline;
      font-size: 22px;
    }
    .step-desc {
      color: #64748b;
      margin: 0 0 24px;
      font-size: 16px;
      line-height: 1.5;
    }

    /* Header row for install steps */
    .step-header-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .tool-icon {
      font-size: 28px;
      line-height: 1;
    }

    /* Status text colors */
    .status-text { font-size: 15px; }
    .status-ok { color: #16a34a; font-weight: 600; }
    .status-err { color: #dc2626; font-weight: 600; }

    /* Preview badge for browser mode */
    .preview-badge {
      display: inline-block;
      background: #fef3c7;
      color: #92400e;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.3px;
      padding: 4px 14px;
      border-radius: 20px;
      margin-bottom: 16px;
      text-transform: uppercase;
    }

    /* ========== Install Progress Bar ========== */
    .install-progress-bar {
      height: 10px;
      background: #e8ecf0;
      border-radius: 5px;
      overflow: hidden;
      margin: 0 0 16px;
      position: relative;
    }
    .install-progress-fill {
      height: 100%;
      border-radius: 5px;
      transition: width 0.4s ease;
      background: linear-gradient(
        90deg,
        #00a884 0%, #00c49a 25%, #00a884 50%, #00c49a 75%, #00a884 100%
      );
      background-size: 200% 100%;
      animation: shimmer 1.8s linear infinite;
    }
    @keyframes shimmer {
      from { background-position: 200% 0; }
      to   { background-position: -200% 0; }
    }

    /* ========== Log Box ========== */
    .log-box {
      background: #1a1a2e;
      border-radius: 10px;
      padding: 14px 16px;
      margin: 0 0 16px;
      max-height: 150px;
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
      line-height: 1.6;
    }

    /* ========== Config List (Ready step) ========== */
    .config-list {
      text-align: left;
      margin: 24px 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .config-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 18px;
      background: #f8fafc;
      border-radius: 10px;
      border: 1px solid #f1f5f9;
    }
    .config-label {
      font-weight: 600;
      font-size: 14px;
      color: #1e293b;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .check-icon {
      color: #16a34a;
      font-weight: 700;
      font-size: 15px;
    }
    .config-value {
      font-size: 13px;
      color: #64748b;
      font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
    }

    /* ========== Buttons ========== */
    .step-actions {
      margin-top: 8px;
    }
    .btn {
      padding: 14px 28px;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      transform: none !important;
    }
    .btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(0, 168, 132, 0.3);
    }
    .btn:active:not(:disabled) {
      transform: translateY(0);
    }
    .btn-primary {
      background: #00a884;
      color: #fff;
    }
    .btn-full {
      width: 100%;
      padding: 16px 28px;
      font-size: 16px;
    }
    .arrow {
      font-size: 18px;
    }

    /* ========== Error ========== */
    .error-text {
      color: #dc2626;
      font-size: 13px;
      margin-top: 16px;
      text-align: center;
      background: #fef2f2;
      padding: 10px 16px;
      border-radius: 8px;
    }
  `],
})
export class SetupComponent implements OnInit, OnDestroy {
  currentStep: WizardStep = 1;
  animateIn = true;
  browserMode = false;

  tools: AllToolsStatus | null = null;
  errorMessage = '';
  isStarting = false;

  // Per-step state
  stepStatus: 'idle' | 'installing' | 'done' | 'error' = 'idle';
  stepProgress = 0;
  stepActionText = '';
  logOutput = '';

  private mockTimer: any = null;

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
    if (this.mockTimer) { clearInterval(this.mockTimer); }
  }

  async checkTools() {
    try {
      this.tools = await this.installer.checkAll();
    } catch (e: any) {
      this.errorMessage = 'Failed to check tools: ' + e.message;
    }
  }

  goToStep(step: WizardStep) {
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

  // --- Mock install simulation for browser mode ---
  private runMockInstall(stepName: string, doneMsg: string, nextAction: () => void) {
    this.stepStatus = 'installing';
    this.stepProgress = 0;
    this.logOutput = '';
    this.stepActionText = 'Installing ' + stepName + '...';

    const mockLines = [
      'Resolving dependencies...',
      'Downloading packages...',
      'Extracting archive...',
      'Compiling native modules...',
      'Linking binaries...',
      'Verifying installation...',
      'Running post-install hooks...',
      'Cleaning up temporary files...',
    ];
    let lineIdx = 0;

    this.mockTimer = setInterval(() => {
      if (this.stepProgress >= 100) {
        clearInterval(this.mockTimer);
        this.mockTimer = null;
        this.stepStatus = 'done';
        this.stepActionText = doneMsg;
        this.logOutput += '\n' + doneMsg + '\n';
        setTimeout(() => nextAction(), 1500);
        return;
      }
      this.stepProgress = Math.min(this.stepProgress + 12, 100);
      if (lineIdx < mockLines.length) {
        this.logOutput += mockLines[lineIdx] + '\n';
        lineIdx++;
      }
      this.scrollLogToBottom();
    }, 400);
  }

  async startSetup() {
    this.isStarting = true;
    if (this.browserMode) {
      this.goToStep(2);
      setTimeout(() => this.runMockStep2(), 200);
      return;
    }
    // Don't wait for tool check — go straight to Step 2
    // Tools will be checked during each install step
    try {
      const checkPromise = this.checkTools();
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, 3000));
      await Promise.race([checkPromise, timeoutPromise]);
    } catch {}
    this.isStarting = false;
    this.goToStep(2);
    setTimeout(() => this.runStep2(), 200);
  }

  private runMockStep2() {
    this.runMockInstall('AI Engine', 'AI Engine is ready!', () => {
      this.goToStep(3);
      setTimeout(() => this.runMockStep3(), 200);
    });
  }

  private runMockStep3() {
    this.runMockInstall('OpenClaw', 'OpenClaw is ready!', () => {
      this.goToStep(4);
    });
  }

  async runStep2() {
    if (this.browserMode) { this.runMockStep2(); return; }
    this.stepStatus = 'installing';
    this.stepProgress = 0;
    this.logOutput = '';
    this.errorMessage = '';

    try {
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
    if (this.browserMode) { this.runMockStep3(); return; }
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
