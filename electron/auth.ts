// Auth module — Google login via myapi OIDC + server-side provisioning
// NO admin tokens, NO secrets in the desktop app.
//
// Flow:
// 1. Open myapi OIDC login page → user signs in with Google
// 2. myapi handles Google OAuth internally, sets session cookie
// 3. Desktop app captures session, calls xbb server to create API key
// 4. App receives { apiKey, baseUrl, email, name }

import { BrowserWindow } from 'electron';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as logger from './logger';

const PROVISION_URL = 'https://xbb.cooltechgp.online/api/auth/provision';
const MYAPI_URL = 'https://myapi.cooltechgp.online';
const AUTH_FILE = path.join(os.homedir(), '.xbb-desktop', 'auth.json');

// ── Types ─────────────────────────────────────────────────────

export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
  myapiUserId: number;
  myapiApiKey: string;
  myapiBaseUrl: string;
  loggedInAt: number;
  sessionCookies?: { name: string; value: string; domain: string }[];
}

// ── Saved auth ────────────────────────────────────────────────

export function loadAuth(): AuthUser | null {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
      if (data.email && data.myapiApiKey) return data;
    }
  } catch {}
  return null;
}

export function saveAuth(user: AuthUser): void {
  try {
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(user, null, 2), 'utf-8');
  } catch (e: any) {
    logger.error('AUTH', 'Failed to save auth:', e.message);
  }
}

export function clearAuth(): void {
  try { fs.unlinkSync(AUTH_FILE); } catch {}
}

/** Restore myapi session cookies into a BrowserWindow's session */
export async function restoreSessionCookies(window: BrowserWindow): Promise<void> {
  const auth = loadAuth();
  if (!auth?.sessionCookies) return;

  const ses = window.webContents.session;
  for (const c of auth.sessionCookies) {
    try {
      await ses.cookies.set({
        url: MYAPI_URL,
        name: c.name,
        value: c.value,
        domain: c.domain,
      });
    } catch {}
  }
}

// ── HTTP helper ───────────────────────────────────────────────

function httpRequest(url: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(parsed, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 15000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => body += chunk.toString());
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── Login via myapi OIDC (Google Sign-In) ─────────────────────

export async function loginViaMyapiOIDC(parentWindow: BrowserWindow): Promise<AuthUser> {
  logger.log('AUTH', 'Starting myapi OIDC login');

  return new Promise((resolve, reject) => {
    let resolved = false;
    let pollTimer: NodeJS.Timeout | null = null;

    const authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      parent: parentWindow,
      modal: true,
      show: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    const completeLogin = async () => {
      if (resolved) return;
      resolved = true;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

      try {
        // Get session cookies from the auth window
        const cookies = await authWindow.webContents.session.cookies.get({ url: MYAPI_URL });
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        logger.log('AUTH', 'Got cookies, checking session...');

        // Get user info from myapi using the session
        const userResp = await httpRequest(`${MYAPI_URL}/api/user/self`, {
          headers: { 'Cookie': cookieStr },
        });
        const userData = JSON.parse(userResp.body);

        if (!userData.success || !userData.data) {
          throw new Error('Failed to get user info after login');
        }

        const user = userData.data;
        const email = user.email || `user${user.id}@myapi.local`;
        const displayName = user.display_name || user.username;
        logger.log('AUTH', 'Session verified:', email);

        // Call provision endpoint — server creates API key securely
        const provResp = await httpRequest(PROVISION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_cookie: cookieStr,
            myapi_user_id: user.id,
            verified_email: email,
            verified_name: displayName,
          }),
        });

        const provResult = JSON.parse(provResp.body);
        if (!provResult.success) throw new Error(provResult.error || 'Provisioning failed');

        const auth: AuthUser = {
          email: provResult.data.email,
          name: provResult.data.name,
          picture: provResult.data.picture,
          myapiUserId: provResult.data.userId,
          myapiApiKey: provResult.data.apiKey,
          myapiBaseUrl: provResult.data.baseUrl,
          loggedInAt: Date.now(),
          sessionCookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain || '.cooltechgp.online' })),
        };

        saveAuth(auth);
        authWindow.close();
        logger.remote('user-login', 'info', `User logged in: ${email}`);
        resolve(auth);
      } catch (e: any) {
        logger.error('AUTH', 'Login completion failed:', e.message);
        resolved = false; // allow retry
      }
    };

    // Method 1: detect navigation events
    const handleNavigation = async (url: string) => {
      if (resolved) return;
      logger.log('AUTH', 'Navigation:', url);
      if (!url.startsWith(MYAPI_URL)) return;
      // Skip pages that are still in the auth flow
      if (url.includes('/oauth/') || url.includes('/login')) return;
      // Landed on dashboard/home — login succeeded
      await completeLogin();
    };

    authWindow.webContents.on('will-redirect', (_e, url) => handleNavigation(url));
    authWindow.webContents.on('did-navigate', (_e, url) => handleNavigation(url));
    authWindow.webContents.on('did-navigate-in-page', (_e, url) => handleNavigation(url));

    // Method 2: poll for session cookie every 2 seconds
    // This catches cases where SPA routing doesn't trigger navigation events
    pollTimer = setInterval(async () => {
      if (resolved) return;
      try {
        const cookies = await authWindow.webContents.session.cookies.get({ url: MYAPI_URL });
        const sessionCookie = cookies.find(c => c.name === 'session');
        if (sessionCookie) {
          logger.log('AUTH', 'Session cookie detected via polling');
          await completeLogin();
        }
      } catch {}
    }, 2000);

    authWindow.on('closed', () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (!resolved) { resolved = true; reject(new Error('Login cancelled')); }
    });

    // Open myapi login page
    authWindow.loadURL(`${MYAPI_URL}/login`);

    setTimeout(() => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (!resolved) { resolved = true; authWindow?.close(); reject(new Error('Login timed out')); }
    }, 120000);
  });
}
