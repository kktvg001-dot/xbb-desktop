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
      width: 200px;
      background: var(--bg-sidebar);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      color: var(--sidebar-text);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      border-right: 1px solid var(--sidebar-border);
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
      font-size: 22px;
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .logo-text {
      font-size: 17px;
      font-weight: 700;
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      letter-spacing: -0.3px;
    }
    .nav-list {
      list-style: none;
      margin: 0;
      padding: 12px 8px;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      color: var(--sidebar-nav-text);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s ease;
      border-left: 3px solid transparent;
      border-radius: 0 8px 8px 0;
      position: relative;
    }
    .nav-item::after {
      display: none;
    }
    .nav-item:hover {
      background: var(--sidebar-nav-hover-bg);
      color: var(--sidebar-nav-hover-text);
      transform: translateX(2px);
    }
    .nav-item.active {
      background: rgba(124, 92, 252, 0.1);
      color: var(--accent);
      border-left-color: var(--accent);
      box-shadow: inset 0 0 16px rgba(124, 92, 252, 0.05);
    }
    .nav-icon {
      font-size: 16px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: var(--bg-hover);
      flex-shrink: 0;
      transition: all 0.2s ease;
    }
    .nav-item:hover .nav-icon {
      background: rgba(124, 92, 252, 0.15);
      transform: scale(1.05);
    }
    .nav-item.active .nav-icon {
      background: rgba(124, 92, 252, 0.2);
      box-shadow: 0 0 10px rgba(124, 92, 252, 0.15);
    }
    .sidebar-footer {
      padding: 14px 12px;
      border-top: 1px solid var(--sidebar-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .theme-toggle {
      background: var(--bg-hover);
      border: 1px solid var(--sidebar-border);
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 14px;
      cursor: pointer;
      line-height: 1;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .theme-toggle:hover {
      background: rgba(124, 92, 252, 0.1);
      border-color: var(--accent);
      box-shadow: 0 0 12px rgba(124, 92, 252, 0.1);
    }
    .version {
      font-size: 11px;
      color: var(--sidebar-version);
      font-family: 'JetBrains Mono', monospace;
    }
    .main-content {
      flex: 1;
      overflow-y: auto;
      background: var(--bg-primary);
      animation: fadeIn 0.3s ease;
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
