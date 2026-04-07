import { Component, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dashboard-page">
      <div class="dashboard-header">
        <h2>API Dashboard</h2>
        <div class="dashboard-actions">
          <button class="btn-refresh" (click)="reload()">Refresh</button>
          <button class="btn-external" (click)="openExternal()">Open in Browser</button>
        </div>
      </div>
      <iframe
        #dashboardFrame
        *ngIf="dashboardUrl"
        [src]="dashboardUrl"
        class="dashboard-iframe"
        (load)="onLoad()">
      </iframe>
      <div class="loading" *ngIf="loading">Loading dashboard...</div>
    </div>
  `,
  styles: [`
    .dashboard-page {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .dashboard-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .dashboard-header h2 {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0;
    }
    .dashboard-actions {
      display: flex;
      gap: 8px;
    }
    .btn-refresh, .btn-external {
      padding: 5px 12px;
      font-size: 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg-card);
      color: var(--text-secondary);
      cursor: pointer;
    }
    .btn-refresh:hover, .btn-external:hover {
      background: var(--bg-hover);
    }
    .dashboard-iframe {
      flex: 1;
      border: none;
      width: 100%;
    }
    .loading {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      font-size: 14px;
    }
  `],
})
export class DashboardComponent implements OnInit {
  @ViewChild('dashboardFrame') frame!: ElementRef<HTMLIFrameElement>;

  dashboardUrl: SafeResourceUrl | null = null;
  loading = true;

  private rawUrl = 'https://myapi.cooltechgp.online';

  constructor(private sanitizer: DomSanitizer) {}

  async ngOnInit() {
    // Restore myapi session cookies so iframe auto-logins
    if ((window as any).electronAPI?.authRestoreSession) {
      await (window as any).electronAPI.authRestoreSession();
    }
    this.dashboardUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.rawUrl);
  }

  onLoad() {
    this.loading = false;
  }

  reload() {
    this.loading = true;
    if (this.frame?.nativeElement) {
      this.frame.nativeElement.src = this.rawUrl;
    }
  }

  openExternal() {
    // Open in system browser
    if ((window as any).electronAPI) {
      // Use shell.openExternal via a simple approach
      window.open(this.rawUrl, '_blank');
    }
  }
}
