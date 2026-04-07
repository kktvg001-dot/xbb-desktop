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
  // Send all auth debug logs to remote so we can see them on the server
  let debugSeq = 0;
  const debug = (msg: string) => {
    logger.log('AUTH', msg);
    // Each debug log gets a unique key to bypass dedup
    logger.remote(`auth-debug-${++debugSeq}`, 'info', `[AUTH] ${msg}`);
  };

  debug('Starting myapi OIDC login');

  return new Promise((resolve, reject) => {
    let resolved = false;
    let pollTimer: NodeJS.Timeout | null = null;
    let pollCount = 0;

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
        // Get ALL cookies from the auth window
        const cookies = await authWindow.webContents.session.cookies.get({ url: MYAPI_URL });
        debug(`Got ${cookies.length} cookies: ${cookies.map(c => c.name).join(', ')}`);

        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        // Get user info from myapi using the session
        debug('Calling /api/user/self...');
        const userResp = await httpRequest(`${MYAPI_URL}/api/user/self`, {
          headers: { 'Cookie': cookieStr },
        });
        debug(`/api/user/self response status: ${userResp.status}`);

        const userData = JSON.parse(userResp.body);
        if (!userData.success || !userData.data) {
          debug(`/api/user/self failed: ${userData.message || 'no data'}`);
          throw new Error('Failed to get user info after login');
        }

        const user = userData.data;
        const email = user.email || `user${user.id}@myapi.local`;
        const displayName = user.display_name || user.username;
        debug(`Session verified: ${email} (id=${user.id})`);

        // Call provision endpoint
        debug('Calling provision endpoint...');
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
        debug(`Provision response: success=${provResult.success}, error=${provResult.error || 'none'}`);
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
        debug(`LOGIN COMPLETE: ${email}`);
        resolve(auth);
      } catch (e: any) {
        debug(`completeLogin error: ${e.message}`);
        resolved = false; // allow retry
      }
    };

    // Method 1: detect navigation events
    const handleNavigation = async (eventName: string, url: string) => {
      if (resolved) return;
      debug(`[${eventName}] ${url}`);
      if (!url.startsWith(MYAPI_URL)) return;
      if (url.includes('/oauth/') || url.includes('/login')) {
        debug(`Skipping (auth flow page): ${url}`);
        return;
      }
      debug(`Detected dashboard URL, completing login...`);
      await completeLogin();
    };

    authWindow.webContents.on('will-redirect', (_e, url) => handleNavigation('will-redirect', url));
    authWindow.webContents.on('did-navigate', (_e, url) => handleNavigation('did-navigate', url));
    authWindow.webContents.on('did-navigate-in-page', (_e, url) => handleNavigation('did-navigate-in-page', url));
    authWindow.webContents.on('did-finish-load', () => {
      const url = authWindow.webContents.getURL();
      debug(`[did-finish-load] ${url}`);
    });

    // Method 2: poll for session cookie every 2 seconds
    pollTimer = setInterval(async () => {
      if (resolved) return;
      pollCount++;
      try {
        const cookies = await authWindow.webContents.session.cookies.get({ url: MYAPI_URL });
        const cookieNames = cookies.map(c => c.name);
        const sessionCookie = cookies.find(c => c.name === 'session');
        // Log every 5th poll to avoid spam, but always log when cookies change
        if (pollCount % 5 === 1 || sessionCookie) {
          debug(`[poll #${pollCount}] cookies: [${cookieNames.join(', ')}] session=${sessionCookie ? 'YES' : 'no'}`);
        }
        if (sessionCookie) {
          debug('Session cookie found via polling! Completing login...');
          await completeLogin();
        }
      } catch (e: any) {
        debug(`[poll error] ${e.message}`);
      }
    }, 2000);

    authWindow.on('closed', () => {
      debug('Auth window closed');
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (!resolved) { resolved = true; reject(new Error('Login cancelled')); }
    });

    // Open myapi login page
    debug(`Loading ${MYAPI_URL}/login`);
    authWindow.loadURL(`${MYAPI_URL}/login`);

    setTimeout(() => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (!resolved) { resolved = true; debug('Login timed out'); authWindow?.close(); reject(new Error('Login timed out')); }
    }, 120000);
  });
}
