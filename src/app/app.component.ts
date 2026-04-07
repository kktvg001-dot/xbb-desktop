import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { InstallerService } from './services/installer.service';
import { Subscription, filter } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterModule, RouterLink, RouterLinkActive],
  template: `
    <div class="app-layout">
      <nav class="sidebar" *ngIf="showSidebar">
        <div class="sidebar-header">
          <div class="logo">
            <span class="logo-icon">&#9672;</span>
            <span class="logo-text">OpenClaw</span>
          </div>
        </div>
        <ul class="nav-list">
          <li *ngIf="showSetupLink">
            <a routerLink="/setup" routerLinkActive="active" class="nav-item">
              <span class="nav-icon">&#9881;</span>
              <span class="nav-label">Setup</span>
            </a>
          </li>
          <li>
            <a routerLink="/chat" routerLinkActive="active" class="nav-item">
              <span class="nav-icon">&#128172;</span>
              <span class="nav-label">Chat</span>
            </a>
          </li>
          <li>
            <a routerLink="/status" routerLinkActive="active" class="nav-item">
              <span class="nav-icon">&#9632;</span>
              <span class="nav-label">Status</span>
            </a>
          </li>
          <li>
            <a routerLink="/tasks" routerLinkActive="active" class="nav-item">
              <span class="nav-icon">&#9200;</span>
              <span class="nav-label">Tasks</span>
            </a>
          </li>
          <li>
            <a routerLink="/settings" routerLinkActive="active" class="nav-item">
              <span class="nav-icon">&#9998;</span>
              <span class="nav-label">Settings</span>
            </a>
          </li>
        </ul>
        <div class="sidebar-footer">
          <button class="theme-toggle" (click)="toggleTheme()" [title]="isDarkTheme ? 'Switch to light mode' : 'Switch to dark mode'">
            {{ isDarkTheme ? '\u2600\uFE0F' : '\uD83C\uDF19' }}
          </button>
          <span class="version">v1.0.7</span>
        </div>
      </nav>
      <main class="main-content">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [`
    .app-layout {
      display: flex;
      height: 100vh;
      overflow: hidden;
    }
    .sidebar {
      width: 220px;
      background: var(--bg-sidebar);
      color: var(--sidebar-text);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .sidebar-header {
      padding: 20px 16px;
      border-bottom: 1px solid var(--sidebar-border);
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo-icon {
      font-size: 24px;
      color: var(--accent);
    }
    .logo-text {
      font-size: 18px;
      font-weight: 700;
      color: var(--sidebar-logo-text);
    }
    .nav-list {
      list-style: none;
      margin: 0;
      padding: 12px 0;
      flex: 1;
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      color: var(--sidebar-nav-text);
      text-decoration: none;
      font-size: 14px;
      transition: all 0.15s ease;
      border-left: 3px solid transparent;
    }
    .nav-item:hover {
      background: var(--sidebar-nav-hover-bg);
      color: var(--sidebar-nav-hover-text);
    }
    .nav-item.active {
      background: rgba(0, 168, 132, 0.1);
      color: var(--accent);
      border-left-color: var(--accent);
    }
    .nav-icon {
      font-size: 18px;
      width: 24px;
      text-align: center;
    }
    .sidebar-footer {
      padding: 16px;
      border-top: 1px solid var(--sidebar-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .theme-toggle {
      background: none;
      border: 1px solid var(--sidebar-border);
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 16px;
      cursor: pointer;
      line-height: 1;
      transition: background 0.15s ease;
    }
    .theme-toggle:hover {
      background: var(--sidebar-nav-hover-bg);
    }
    .version {
      font-size: 12px;
      color: var(--sidebar-version);
    }
    .main-content {
      flex: 1;
      overflow-y: auto;
      background: var(--bg-primary);
    }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  showSidebar = true;
  showSetupLink = false;
  isDarkTheme = true;
  private routeSub!: Subscription;

  constructor(
    private router: Router,
    private installer: InstallerService,
  ) {}

  async ngOnInit() {
    // Load saved theme preference
    const savedTheme = localStorage.getItem('xbb-theme');
    if (savedTheme === 'light') {
      this.isDarkTheme = false;
      document.documentElement.removeAttribute('data-theme');
    } else {
      this.isDarkTheme = true;
      document.documentElement.setAttribute('data-theme', 'dark');
    }

    this.routeSub = this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd)
    ).subscribe((e) => {
      this.showSidebar = !e.urlAfterRedirects.startsWith('/setup');
    });

    // Check if setup was already completed
    const setupDone = localStorage.getItem('xbb-setup-complete');
    if (setupDone === 'true') {
      // Setup was done before — go straight to chat
      this.showSetupLink = false;
      this.router.navigate(['/chat']);
      return;
    }

    // First launch — check tools in background
    if (this.installer.isElectron) {
      setTimeout(async () => {
        try {
          const tools = await this.installer.checkAll();
          const allInstalled = tools.claude.installed && tools.openclaw.installed;
          if (allInstalled) {
            // Tools are installed — mark setup complete and go to chat
            localStorage.setItem('xbb-setup-complete', 'true');
            this.showSetupLink = false;
            this.router.navigate(['/chat']);
          } else {
            this.showSetupLink = true;
            this.router.navigate(['/setup']);
          }
        } catch {
          // Check failed — show setup to be safe
          this.showSetupLink = true;
          this.router.navigate(['/setup']);
        }
      }, 500);
    }
  }

  toggleTheme() {
    this.isDarkTheme = !this.isDarkTheme;
    if (this.isDarkTheme) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('xbb-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('xbb-theme', 'light');
    }
  }

  ngOnDestroy() {
    this.routeSub?.unsubscribe();
  }
}
