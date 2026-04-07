// Auth module — Google OAuth + server-side provisioning
// NO admin tokens here. The desktop app only gets the user's own API key.
//
// Flow:
// 1. Google OAuth popup → get access_token
// 2. Send access_token to xbb.cooltechgp.online/api/auth/provision
// 3. Server verifies with Google, finds/creates user, creates API key
// 4. Desktop app receives { apiKey, baseUrl, email, name }

import { BrowserWindow } from 'electron';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as logger from './logger';

// ── Config ────────────────────────────────────────────────────

const PROVISION_URL = 'https://xbb.cooltechgp.online/api/auth/provision';

// Google OAuth — same client ID as myapi OIDC
const GOOGLE_CLIENT_ID = '138213524191-aps1ebhqi8bamsf3dvlh1d98p23p6mk1.apps.googleusercontent.com';
const GOOGLE_REDIRECT_URI = 'https://myapi.cooltechgp.online/oauth/oidc';

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
    const dir = path.dirname(AUTH_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(user, null, 2), 'utf-8');
  } catch (e: any) {
    logger.error('AUTH', 'Failed to save auth:', e.message);
  }
}

export function clearAuth(): void {
  try { fs.unlinkSync(AUTH_FILE); } catch {}
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

// ── Google OAuth Flow ─────────────────────────────────────────

export async function loginWithGoogle(parentWindow: BrowserWindow): Promise<AuthUser> {
  logger.log('AUTH', 'Starting Google OAuth flow');

  // Step 1: Get Google access_token via OAuth popup
  const googleAccessToken = await getGoogleAccessToken(parentWindow);

  // Step 2: Send to our server for provisioning (server handles all admin stuff)
  logger.log('AUTH', 'Got Google token, calling provision endpoint');
  const resp = await httpRequest(PROVISION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: googleAccessToken }),
  });

  const result = JSON.parse(resp.body);
  if (!result.success) {
    throw new Error(result.error || 'Provisioning failed');
  }

  const data = result.data;
  const auth: AuthUser = {
    email: data.email,
    name: data.name,
    picture: data.picture,
    myapiUserId: data.userId,
    myapiApiKey: data.apiKey,
    myapiBaseUrl: data.baseUrl,
    loggedInAt: Date.now(),
  };

  saveAuth(auth);
  logger.log('AUTH', 'Login complete:', auth.email);
  logger.remote('user-login', 'info', `User logged in: ${auth.email}`);
  return auth;
}

// ── Google OAuth via Electron BrowserWindow ───────────────────

function getGoogleAccessToken(parentWindow: BrowserWindow): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use Google's OAuth with a local callback server
    const callbackPort = 19823;
    let resolved = false;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost:${callbackPort}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (code && !resolved) {
        resolved = true;
        res.end('<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#171717;color:#fff"><h2>Login successful!</h2><p>You can close this window.</p><script>window.close()</script></body></html>');
        server.close();
        authWindow?.close();
        // Exchange code for access_token via Google token endpoint
        exchangeCodeForToken(code).then(resolve).catch(reject);
      } else if (error) {
        res.end('<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#171717;color:#ef4444"><h2>Login failed</h2><p>' + (error || 'Unknown error') + '</p></body></html>');
        if (!resolved) { resolved = true; server.close(); authWindow?.close(); reject(new Error(error)); }
      } else {
        res.end('');
      }
    });

    server.listen(callbackPort, '127.0.0.1');

    const redirectUri = `http://localhost:${callbackPort}/callback`;

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account',
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

    let authWindow: BrowserWindow | null = new BrowserWindow({
      width: 500,
      height: 700,
      parent: parentWindow,
      modal: true,
      show: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    authWindow.loadURL(authUrl);
    authWindow.on('closed', () => {
      authWindow = null;
      if (!resolved) { resolved = true; server.close(); reject(new Error('Login cancelled')); }
    });

    setTimeout(() => {
      if (!resolved) { resolved = true; server.close(); authWindow?.close(); reject(new Error('Login timed out')); }
    }, 120000);
  });
}

async function exchangeCodeForToken(code: string): Promise<string> {
  // For desktop/installed apps, Google requires client_secret even for "public" clients.
  // We call our server to do the exchange (it has the secret).
  // OR we can just send the code to the provision endpoint and let it handle everything.

  // Simpler: send the auth code directly to our provision endpoint
  const resp = await httpRequest(PROVISION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_code: code, redirect_uri: `http://localhost:19823/callback` }),
  });

  const result = JSON.parse(resp.body);
  if (result.success && result.data?.apiKey) {
    // Server handled everything — return a marker so we skip the second call
    return '__provisioned__';
  }

  throw new Error(result.error || 'Code exchange failed');
}

// ── Alternative: myapi OIDC login (uses myapi's existing Google integration) ──

export async function loginViaMyapiOIDC(parentWindow: BrowserWindow): Promise<AuthUser> {
  logger.log('AUTH', 'Starting myapi OIDC login flow');

  return new Promise((resolve, reject) => {
    let resolved = false;
    const loginUrl = `https://myapi.cooltechgp.online/oauth/oidc`;

    const authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      parent: parentWindow,
      modal: true,
      show: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    const checkUrl = async (url: string) => {
      if (resolved) return;
      // After OIDC login, myapi redirects to dashboard. Session cookie is set.
      if (url.startsWith('https://myapi.cooltechgp.online') && !url.includes('/oauth/')) {
        resolved = true;
        try {
          // Get all cookies
          const cookies = await authWindow.webContents.session.cookies.get({ url: 'https://myapi.cooltechgp.online' });
          const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

          // Get user info with session
          const userResp = await httpRequest('https://myapi.cooltechgp.online/api/user/self', {
            headers: { 'Cookie': cookieStr },
          });
          const userData = JSON.parse(userResp.body);

          if (!userData.success || !userData.data) {
            throw new Error('Failed to get user info after login');
          }

          const user = userData.data;
          const email = user.email || `user${user.id}@myapi.local`;

          // Now call our provision endpoint with a special "session" flow
          // Actually, we already have the user — we just need to create a token
          // Send to provision endpoint with verified email
          const provResp = await httpRequest(PROVISION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              verified_email: email,
              verified_name: user.display_name || user.username,
              myapi_user_id: user.id,
              // This is a trusted call since we verified via myapi session
              session_cookie: cookieStr,
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
          };

          saveAuth(auth);
          authWindow.close();
          logger.remote('user-login', 'info', `User logged in: ${email}`);
          resolve(auth);
        } catch (e: any) {
          authWindow.close();
          reject(e);
        }
      }
    };

    authWindow.webContents.on('will-redirect', (_e, url) => checkUrl(url));
    authWindow.webContents.on('did-navigate', (_e, url) => checkUrl(url));

    authWindow.on('closed', () => {
      if (!resolved) { resolved = true; reject(new Error('Login cancelled')); }
    });

    authWindow.loadURL(loginUrl);

    setTimeout(() => {
      if (!resolved) { resolved = true; authWindow?.close(); reject(new Error('Login timed out')); }
    }, 120000);
  });
}
