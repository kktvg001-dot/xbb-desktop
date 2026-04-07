import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OpenclawService, OpenclawStatus } from '../../services/openclaw.service';

interface TreeNode {
  name: string;
  isDirectory: boolean;
  path: string;
  children?: TreeNode[];
  expanded?: boolean;
  loading?: boolean;
  depth: number;
}

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
        <pre>{{ status?.raw }}</pre>
      </div>

      <div class="file-tree-section">
        <h2>Workspace Files</h2>
        <p class="tree-path" *ngIf="workspacePath">{{ workspacePath }}</p>
        <div class="file-tree" *ngIf="treeNodes.length > 0">
          <ng-container *ngFor="let node of flattenedTree">
            <div class="tree-node"
                 [style.padding-left.px]="node.depth * 20 + 8"
                 (click)="toggleNode(node)"
                 [class.folder]="node.isDirectory"
                 [class.file]="!node.isDirectory">
              <span class="tree-icon" *ngIf="node.isDirectory">
                {{ node.expanded ? '\uD83D\uDCC2' : '\uD83D\uDCC1' }}
              </span>
              <span class="tree-icon" *ngIf="!node.isDirectory">\uD83D\uDCC4</span>
              <span class="tree-name">{{ node.name }}</span>
              <span class="tree-loading" *ngIf="node.loading">...</span>
            </div>
          </ng-container>
        </div>
        <p class="tree-empty" *ngIf="treeNodes.length === 0 && !treeLoading">No files found.</p>
        <p class="tree-empty" *ngIf="treeLoading">Loading...</p>
      </div>
    </div>
  `,
  styles: [`
    .status-page {
      padding: 32px;
      max-width: 800px;
      animation: statusFadeIn 0.2s ease;
    }
    @keyframes statusFadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 28px;
    }
    .page-header h1 {
      font-size: 22px;
      margin: 0;
      color: var(--text-heading);
      font-weight: 600;
      letter-spacing: -0.3px;
    }
    .refresh-btn {
      background: var(--accent);
      color: var(--bg-primary);
      border: none;
      padding: 8px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .refresh-btn:hover:not(:disabled) {
      background: var(--accent-hover);
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
      background: var(--card-bg);
      border-radius: 10px;
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 16px;
      border: 1px solid var(--border);
    }
    .status-card:hover {
      border-color: var(--border-hover);
    }
    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--text-muted);
    }
    .status-dot.green {
      background: #10a37f;
    }
    .status-dot.red {
      background: #ef4444;
    }
    .status-dot.neutral {
      background: var(--text-muted);
    }
    .status-info h3 {
      margin: 0 0 4px;
      font-size: 13px;
      color: var(--text-muted);
      font-weight: 500;
    }
    .status-value {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .status-value.connected {
      color: var(--success-text);
    }
    .actions-section {
      margin-bottom: 32px;
    }
    .actions-section h2 {
      font-size: 18px;
      color: var(--text-heading);
      margin: 0 0 16px;
      font-weight: 600;
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
      background: var(--accent);
      color: var(--bg-primary);
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--accent-hover);
    }
    .btn-secondary {
      background: var(--btn-secondary-bg);
      color: var(--btn-secondary-text);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover:not(:disabled) {
      background: var(--bg-hover);
    }
    .action-result {
      margin-top: 12px;
      font-size: 13px;
      color: var(--success-text);
    }
    .action-result.error {
      color: var(--error-text);
    }
    .raw-output {
      margin-top: 24px;
    }
    .raw-output h2 {
      font-size: 18px;
      color: var(--text-heading);
      margin: 0 0 12px;
      font-weight: 600;
    }
    .raw-output pre {
      background: var(--bg-code);
      color: #e0e0e0;
      padding: 16px;
      border-radius: 8px;
      font-size: 12px;
      overflow-x: auto;
      line-height: 1.5;
    }
    .file-tree-section {
      margin-top: 32px;
    }
    .file-tree-section h2 {
      font-size: 18px;
      color: var(--text-heading);
      margin: 0 0 8px;
      font-weight: 600;
    }
    .tree-path {
      font-size: 12px;
      color: var(--text-muted);
      margin: 0 0 12px;
      font-family: 'JetBrains Mono', monospace;
    }
    .file-tree {
      background: var(--card-bg);
      border-radius: 8px;
      padding: 8px 0;
      border: 1px solid var(--border);
      max-height: 400px;
      overflow-y: auto;
    }
    .tree-node {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      font-size: 13px;
      color: var(--text-primary);
      cursor: default;
      user-select: none;
    }
    .tree-node.folder {
      cursor: pointer;
    }
    .tree-node.folder:hover {
      background: var(--bg-hover);
    }
    .tree-icon {
      font-size: 14px;
      flex-shrink: 0;
    }
    .tree-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tree-loading {
      font-size: 11px;
      color: var(--text-muted);
    }
    .tree-empty {
      font-size: 13px;
      color: var(--text-muted);
      margin: 8px 0 0;
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

  // File tree
  treeNodes: TreeNode[] = [];
  treeLoading = false;
  workspacePath = '';

  private static readonly MAX_DEPTH = 3;

  constructor(private openclaw: OpenclawService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.refresh();
    this.loadWorkspaceTree();
  }

  get flattenedTree(): TreeNode[] {
    const result: TreeNode[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        result.push(node);
        if (node.isDirectory && node.expanded && node.children) {
          walk(node.children);
        }
      }
    };
    walk(this.treeNodes);
    return result;
  }

  async loadWorkspaceTree() {
    this.treeLoading = true;
    try {
      const config = await (window as any).electronAPI.getConfig();
      this.workspacePath = config.defaultWorkspace || config.homeDir;
      const items = await (window as any).electronAPI.listDirectory(this.workspacePath);
      this.treeNodes = (items || []).map((item: any) => ({
        ...item,
        depth: 0,
        expanded: false,
        loading: false,
        children: undefined,
      }));
    } catch {
      this.treeNodes = [];
    }
    this.treeLoading = false;
    this.cdr.detectChanges();
  }

  async toggleNode(node: TreeNode) {
    if (!node.isDirectory) return;

    if (node.expanded) {
      node.expanded = false;
      return;
    }

    if (node.depth >= StatusComponent.MAX_DEPTH - 1) return;

    if (!node.children) {
      node.loading = true;
      this.cdr.detectChanges();
      try {
        const items = await (window as any).electronAPI.listDirectory(node.path);
        node.children = (items || []).map((item: any) => ({
          ...item,
          depth: node.depth + 1,
          expanded: false,
          loading: false,
          children: undefined,
        }));
      } catch {
        node.children = [];
      }
      node.loading = false;
    }

    node.expanded = true;
    this.cdr.detectChanges();
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
