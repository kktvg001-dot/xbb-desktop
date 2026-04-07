import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">&#10070;</div>
        <h1>OpenClaw</h1>
        <p class="login-subtitle">Your AI assistant for managing WhatsApp bots, running commands, and getting things done.</p>

        <button class="google-btn" (click)="loginWithGoogle()" [disabled]="loading">
          <svg *ngIf="!loading" width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          <span *ngIf="!loading">Sign in with Google</span>
          <span *ngIf="loading">Signing in...</span>
        </button>

        <p class="login-error" *ngIf="error">{{ error }}</p>

        <p class="login-footer">By signing in, your API key is automatically created and configured. No manual setup needed.</p>
      </div>
    </div>
  `,
  styles: [`
    .login-page {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background: var(--bg-primary);
      animation: fadeIn 0.3s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .login-card {
      text-align: center;
      max-width: 400px;
      padding: 48px 40px;
    }
    .login-logo {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-primary);
      font-size: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    h1 {
      font-size: 26px;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0 0 8px;
      letter-spacing: -0.5px;
    }
    .login-subtitle {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.5;
      margin: 0 0 32px;
    }
    .google-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 12px 24px;
      background: #fff;
      color: #3c4043;
      border: 1px solid #dadce0;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s;
    }
    .google-btn:hover:not(:disabled) {
      background: #f7f8f8;
      border-color: #c6c6c6;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .google-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .login-error {
      margin-top: 16px;
      font-size: 13px;
      color: #ef4444;
      background: rgba(239,68,68,0.08);
      padding: 8px 12px;
      border-radius: 6px;
    }
    .login-footer {
      margin-top: 24px;
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.5;
    }
  `],
})
export class LoginComponent implements OnInit {
  loading = false;
  error = '';

  constructor(private router: Router) {}

  async ngOnInit() {
    // Check if already logged in
    if ((window as any).electronAPI?.authGetUser) {
      const user = await window.electronAPI.authGetUser();
      if (user) {
        this.router.navigate(['/chat']);
      }
    }
  }

  async loginWithGoogle() {
    this.loading = true;
    this.error = '';

    try {
      const result = await window.electronAPI.authLoginGoogle();
      if (result.success) {
        this.router.navigate(['/chat']);
      } else {
        this.error = result.error || 'Login failed. Please try again.';
      }
    } catch (e: any) {
      this.error = e.message || 'Something went wrong.';
    }

    this.loading = false;
  }
}
