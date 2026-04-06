import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterModule, RouterLink, RouterLinkActive],
  template: `
    <div class="app-layout">
      <nav class="sidebar">
        <div class="sidebar-header">
          <div class="logo">
            <span class="logo-icon">&#9672;</span>
            <span class="logo-text">OpenClaw</span>
          </div>
        </div>
        <ul class="nav-list">
          <li>
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
            <a routerLink="/settings" routerLinkActive="active" class="nav-item">
              <span class="nav-icon">&#9998;</span>
              <span class="nav-label">Settings</span>
            </a>
          </li>
        </ul>
        <div class="sidebar-footer">
          <span class="version">v1.0.0</span>
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
      background: #1a1a2e;
      color: #e0e0e0;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .sidebar-header {
      padding: 20px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo-icon {
      font-size: 24px;
      color: #00a884;
    }
    .logo-text {
      font-size: 18px;
      font-weight: 700;
      color: #fff;
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
      color: #b0b0b0;
      text-decoration: none;
      font-size: 14px;
      transition: all 0.15s ease;
      border-left: 3px solid transparent;
    }
    .nav-item:hover {
      background: rgba(255,255,255,0.05);
      color: #fff;
    }
    .nav-item.active {
      background: rgba(0, 168, 132, 0.1);
      color: #00a884;
      border-left-color: #00a884;
    }
    .nav-icon {
      font-size: 18px;
      width: 24px;
      text-align: center;
    }
    .sidebar-footer {
      padding: 16px;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .version {
      font-size: 12px;
      color: #666;
    }
    .main-content {
      flex: 1;
      overflow-y: auto;
      background: #f5f5f5;
    }
  `],
})
export class AppComponent {}
