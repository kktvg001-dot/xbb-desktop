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
          <button class="menu-btn" (click)="showMenu = !showMenu" title="Menu">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="3" r="1.5" fill="currentColor"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="8" cy="13" r="1.5" fill="currentColor"/></svg>
          </button>
        </div>
        <div class="nav-menu" *ngIf="showMenu">
          <a routerLink="/status" class="menu-item" (click)="showMenu = false">Status</a>
          <a routerLink="/tasks" class="menu-item" (click)="showMenu = false">Tasks</a>
          <a routerLink="/settings" class="menu-item" (click)="showMenu = false">Settings</a>
          <a *ngIf="showSetupLink" routerLink="/setup" class="menu-item" (click)="showMenu = false">Setup</a>
        </div>
        <div class="sidebar-nav">
          <a routerLink="/chat" routerLinkActive="active" class="nav-item">
            Chat
          </a>
        </div>
        <div class="sidebar-footer">
          <button class="theme-toggle" (click)="toggleTheme()" [title]="isDarkTheme ? 'Switch to light mode' : 'Switch to dark mode'">
            {{ isDarkTheme ? 'Light' : 'Dark' }}
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
      width: 260px;
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      border-right: 1px solid var(--sidebar-border);
    }
    .sidebar-header {
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--sidebar-border);
    }
    .logo-text {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.3px;
    }
    .menu-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .menu-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .nav-menu {
      position: absolute;
      top: 48px;
      right: auto;
      left: 160px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 4px 0;
      z-index: 100;
      min-width: 140px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .menu-item {
      display: block;
      padding: 8px 16px;
      font-size: 13px;
      color: var(--text-primary);
      text-decoration: none;
      cursor: pointer;
    }
    .menu-item:hover {
      background: var(--bg-hover);
    }
    .sidebar-nav {
      padding: 8px 8px;
      flex: 1;
    }
    .nav-item {
      display: block;
      padding: 8px 12px;
      color: var(--sidebar-nav-text);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
    }
    .nav-item:hover {
      background: var(--sidebar-hover);
      color: var(--text-primary);
    }
    .nav-item.active {
      background: var(--sidebar-active);
      color: var(--text-primary);
    }
    .sidebar-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--sidebar-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .theme-toggle {
      background: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 12px;
      font-size: 12px;
      cursor: pointer;
      color: var(--text-secondary);
    }
    .theme-toggle:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
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
