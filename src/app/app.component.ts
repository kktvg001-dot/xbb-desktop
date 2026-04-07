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
          <span class="logo-text">OpenClaw</span>
        </div>
        <ul class="nav-list">
          <li>
            <a routerLink="/chat" routerLinkActive="active" class="nav-item">
              <span class="nav-icon">💬</span> Chat
            </a>
          </li>
          <li>
            <a routerLink="/status" routerLinkActive="active" class="nav-item">
              <span class="nav-icon">📊</span> Status
            </a>
          </li>
          <li>
            <a routerLink="/tasks" routerLinkActive="active" class="nav-item">
              <span class="nav-icon">⏰</span> Tasks
            </a>
          </li>
          <li>
            <a routerLink="/settings" routerLinkActive="active" class="nav-item">
              <span class="nav-icon">⚙️</span> Settings
            </a>
          </li>
          <li *ngIf="showSetupLink">
            <a routerLink="/setup" routerLinkActive="active" class="nav-item">
              <span class="nav-icon">🔧</span> Setup
            </a>
          </li>
        </ul>
        <div class="sidebar-footer">
          <button class="theme-toggle" (click)="toggleTheme()">
            {{ isDarkTheme ? '☀️ Light' : '🌙 Dark' }}
          </button>
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
      width: 64px;
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      border-right: 1px solid var(--sidebar-border);
      align-items: center;
      padding-top: 16px;
    }
    .sidebar-header {
      padding: 8px;
      text-align: center;
      margin-bottom: 8px;
    }
    .logo-text {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.3px;
    }
    .nav-list {
      list-style: none;
      margin: 0;
      padding: 0;
      flex: 1;
      width: 100%;
    }
    .nav-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 10px 4px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 10px;
      font-weight: 500;
      transition: all 0.15s ease;
      cursor: pointer;
    }
    .nav-icon {
      font-size: 20px;
      line-height: 1;
    }
    .nav-item:hover {
      color: var(--text-primary);
      background: var(--sidebar-hover);
    }
    .nav-item.active {
      color: var(--text-primary);
      background: var(--sidebar-active);
    }
    .sidebar-footer {
      padding: 12px 4px;
      border-top: 1px solid var(--sidebar-border);
      text-align: center;
    }
    .theme-toggle {
      background: none;
      border: none;
      padding: 6px;
      font-size: 16px;
      cursor: pointer;
      border-radius: 8px;
      transition: background 0.15s;
    }
    .theme-toggle:hover {
      background: var(--bg-hover);
    }
    .version {
      font-size: 11px;
      color: var(--text-muted);
    }
    .main-content {
      flex: 1;
      overflow-y: auto;
      background: var(--bg-primary);
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  showSidebar = true;
  showSetupLink = false;
  isDarkTheme = true;
  showMenu = false;
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
      const url = e.urlAfterRedirects;
      this.showSidebar = !url.startsWith('/setup') && !url.startsWith('/login');
    });

    // Step 1: Check if user is logged in
    if ((window as any).electronAPI?.authGetUser) {
      try {
        const user = await (window as any).electronAPI.authGetUser();
        if (!user) {
          // Not logged in — go to login
          this.router.navigate(['/login']);
          return;
        }
      } catch {
        this.router.navigate(['/login']);
        return;
      }
    }

    // Step 2: Check if setup was already completed
    const setupDone = localStorage.getItem('xbb-setup-complete');
    if (setupDone === 'true') {
      this.showSetupLink = false;
      this.router.navigate(['/chat']);
      return;
    }

    // Step 3: First launch — check tools in background
    if (this.installer.isElectron) {
      setTimeout(async () => {
        try {
          const tools = await this.installer.checkAll();
          const allInstalled = tools.claude.installed && tools.openclaw.installed;
          if (allInstalled) {
            localStorage.setItem('xbb-setup-complete', 'true');
            this.showSetupLink = false;
            this.router.navigate(['/chat']);
          } else {
            this.showSetupLink = true;
            this.router.navigate(['/setup']);
          }
        } catch {
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
