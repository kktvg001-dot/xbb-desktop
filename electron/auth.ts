// Auth module — Google OAuth + auto-provisioning on myapi.cooltechgp.online
// Flow: Google login → find/create user → create API token → auto-configure

import { BrowserWindow } from 'electron';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as logger from './logger';

// ── Config ────────────────────────────────────────────────────

const MYAPI_BASE = 'https://myapi.cooltechgp.online';
const ADMIN_TOKEN = 'P+96k2x9dyqcFOxwyOVPtkykC53C52yI';

// Google OAuth — same client ID configured in myapi OIDC settings
const GOOGLE_CLIENT_ID = '138213524191-aps1ebhqi8bamsf3dvlh1d98p23p6mk1.apps.googleusercontent.com';
const GOOGLE_REDIRECT_URI = 'http://localhost:19823/callback';

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

// ── HTTP helpers ──────────────────────────────────────────────

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

async function myapiRequest(method: string, endpoint: string, body?: any): Promise<any> {
  const resp = await httpRequest(`${MYAPI_BASE}${endpoint}`, {
    method,
    headers: {
      'Authorization': ADMIN_TOKEN,
      'New-Api-User': '1',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = JSON.parse(resp.body);
  if (!data.success) {
    throw new Error(data.message || 'API request failed');
  }
  return data.data;
}

// ── Google OAuth ──────────────────────────────────────────────

export async function googleLogin(parentWindow: BrowserWindow): Promise<AuthUser> {
  logger.log('AUTH', 'Starting Google OAuth flow');

  // Step 1: Get Google auth code via popup
  const authCode = await getGoogleAuthCode(parentWindow);

  // Step 2: Exchange code for tokens
  const googleTokens = await exchangeGoogleCode(authCode);

  // Step 3: Get user info from Google
  const googleUser = await getGoogleUserInfo(googleTokens.access_token);
  logger.log('AUTH', 'Google user:', googleUser.email);

  // Step 4: Find or create user on myapi
  const myapiUser = await findOrCreateUser(googleUser.email, googleUser.name);
  logger.log('AUTH', 'myapi user ID:', myapiUser.id);

  // Step 5: Create API token
  const apiKey = await createApiToken(myapiUser.id, `xbb-desktop-${googleUser.email}`);
  logger.log('AUTH', 'API token created');

  // Step 6: Build auth object
  const auth: AuthUser = {
    email: googleUser.email,
    name: googleUser.name,
    picture: googleUser.picture,
    myapiUserId: myapiUser.id,
    myapiApiKey: apiKey,
    myapiBaseUrl: MYAPI_BASE,
    loggedInAt: Date.now(),
  };

  saveAuth(auth);
  logger.remote('user-login', 'info', `User logged in: ${googleUser.email}`);
  return auth;
}

function getGoogleAuthCode(parentWindow: BrowserWindow): Promise<string> {
  return new Promise((resolve, reject) => {
    // Start a local HTTP server to receive the OAuth callback
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost:19823`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (code) {
        res.end('<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#171717;color:#fff"><h2>Login successful!</h2><p>You can close this window.</p><script>window.close()</script></body></html>');
        server.close();
        authWindow?.close();
        resolve(code);
      } else {
        res.end('<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#171717;color:#fff"><h2>Login failed</h2><p>' + (error || 'Unknown error') + '</p></body></html>');
        server.close();
        authWindow?.close();
        reject(new Error(error || 'OAuth cancelled'));
      }
    });

    server.listen(19823, '127.0.0.1');

    // Build Google OAuth URL
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account',
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

    // Open auth window
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
      server.close();
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      authWindow?.close();
      reject(new Error('Login timed out'));
    }, 120000);
  });
}

async function exchangeGoogleCode(code: string): Promise<{ access_token: string }> {
  // We need the client secret for code exchange.
  // Since this is a desktop app (public client), we use the installed app flow.
  // The client secret for installed apps is not truly secret (Google's own docs say this).
  const GOOGLE_CLIENT_SECRET = 'GOCSPX-placeholder'; // Will be set by user

  // For installed/desktop apps, Google recommends using the token endpoint directly.
  // However, since myapi already has OIDC configured, we can use Google's tokeninfo
  // endpoint with the code. But the simplest is to exchange via Google's token endpoint.

  // Actually, for desktop apps we should read the client secret from the OIDC config
  // on the server. Let's fetch it via the myapi status endpoint (it's in the OIDC config).
  // But client_secret isn't exposed in /api/status. We need a different approach.

  // Better approach: use myapi's own OIDC login flow. The user hits myapi's OIDC endpoint,
  // myapi handles the Google exchange internally, and returns a session cookie.
  // Then we use that session to call /api/token.

  // For now, let's use the direct Google exchange. The client secret needs to be provided.
  // Let's read it from the server config.

  // Actually, the cleanest approach for a desktop/Electron app:
  // Use Google Sign-In with PKCE (no client secret needed for installed apps).
  // But Google still requires client_secret for web client IDs.

  // Let's use a simpler approach: redirect to myapi's OIDC login, capture the session.
  throw new Error('Direct Google code exchange needs client_secret - switching to myapi OIDC flow');
}

async function getGoogleUserInfo(accessToken: string): Promise<{ email: string; name: string; picture?: string }> {
  const resp = await httpRequest('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const data = JSON.parse(resp.body);
  return { email: data.email, name: data.name, picture: data.picture };
}

// ── myapi User Management ─────────────────────────────────────

async function findOrCreateUser(email: string, displayName: string): Promise<{ id: number }> {
  // Search by email
  const searchResult = await myapiRequest('GET', `/api/user/search?keyword=${encodeURIComponent(email)}`);
  const users = searchResult?.items || searchResult || [];

  if (Array.isArray(users) && users.length > 0) {
    // Find exact email match
    const existing = users.find((u: any) => u.email === email);
    if (existing) {
      logger.log('AUTH', 'Found existing user:', existing.id);
      return { id: existing.id };
    }
  }

  // Create new user
  const username = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '') + Math.random().toString(36).slice(2, 6);
  const password = generatePassword();

  const newUser = await myapiRequest('POST', '/api/user', {
    username,
    password,
    display_name: displayName || email.split('@')[0],
    email,
  });

  logger.log('AUTH', 'Created new user:', newUser?.id || newUser);
  const userId = newUser?.id || newUser;
  if (typeof userId !== 'number') {
    throw new Error('Failed to get user ID from create response');
  }
  return { id: userId };
}

async function createApiToken(userId: number, tokenName: string): Promise<string> {
  // First check if a token with this name already exists
  // Use admin to act as the user
  const resp = await httpRequest(`${MYAPI_BASE}/api/token/search?keyword=${encodeURIComponent(tokenName)}`, {
    method: 'GET',
    headers: {
      'Authorization': ADMIN_TOKEN,
      'New-Api-User': String(userId),
      'Content-Type': 'application/json',
    },
  });

  try {
    const searchData = JSON.parse(resp.body);
    const existing = searchData?.data?.items || searchData?.data || [];
    if (Array.isArray(existing)) {
      const match = existing.find((t: any) => t.name === tokenName && t.status === 1);
      if (match) {
        // Reveal the existing key
        const keyResp = await httpRequest(`${MYAPI_BASE}/api/token/${match.id}/key`, {
          method: 'POST',
          headers: {
            'Authorization': ADMIN_TOKEN,
            'New-Api-User': String(userId),
            'Content-Type': 'application/json',
          },
        });
        const keyData = JSON.parse(keyResp.body);
        if (keyData.success && keyData.data) {
          return 'sk-' + keyData.data;
        }
      }
    }
  } catch {}

  // Create new token
  const createResp = await httpRequest(`${MYAPI_BASE}/api/token`, {
    method: 'POST',
    headers: {
      'Authorization': ADMIN_TOKEN,
      'New-Api-User': String(userId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: tokenName,
      remain_quota: 0,
      unlimited_quota: true,
      expired_time: -1,
    }),
  });

  const createData = JSON.parse(createResp.body);
  if (!createData.success) {
    throw new Error(createData.message || 'Failed to create token');
  }

  // The create response includes the key
  const key = createData.data?.key || createData.data;
  if (typeof key === 'string') {
    return key.startsWith('sk-') ? key : 'sk-' + key;
  }

  throw new Error('Failed to extract API key from response');
}

function generatePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ── myapi OIDC Login Flow (server-side exchange) ──────────────
// Instead of exchanging Google code ourselves, redirect user to
// myapi's OIDC login and capture the resulting session/token.

export async function loginViaMyapiOIDC(parentWindow: BrowserWindow): Promise<AuthUser> {
  logger.log('AUTH', 'Starting myapi OIDC login flow');

  return new Promise((resolve, reject) => {
    const loginUrl = `${MYAPI_BASE}/oauth/oidc`;

    const authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      parent: parentWindow,
      modal: true,
      show: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    // Watch for navigation back to myapi after Google login
    authWindow.webContents.on('will-redirect', async (_event, url) => {
      await handleRedirect(url, authWindow, resolve, reject);
    });

    authWindow.webContents.on('did-navigate', async (_event, url) => {
      await handleRedirect(url, authWindow, resolve, reject);
    });

    authWindow.on('closed', () => {
      reject(new Error('Login window closed'));
    });

    authWindow.loadURL(loginUrl);

    setTimeout(() => {
      authWindow?.close();
      reject(new Error('Login timed out'));
    }, 120000);
  });
}

async function handleRedirect(
  url: string,
  authWindow: BrowserWindow,
  resolve: (user: AuthUser) => void,
  reject: (err: Error) => void,
): Promise<void> {
  // After successful OIDC login, myapi redirects to the dashboard
  // The session cookie is set. We can now get user info and create a token.
  if (url.startsWith(MYAPI_BASE) && !url.includes('/oauth/')) {
    try {
      // Get cookies from the session
      const cookies = await authWindow.webContents.session.cookies.get({ url: MYAPI_BASE });
      const sessionCookie = cookies.find(c => c.name === 'session');

      if (!sessionCookie) {
        // Try to get user info directly - sometimes the cookie name differs
        const allCookies = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        // Get user info using the session
        const userResp = await httpRequest(`${MYAPI_BASE}/api/user/self`, {
          headers: { 'Cookie': allCookies },
        });
        const userData = JSON.parse(userResp.body);

        if (userData.success && userData.data) {
          const user = userData.data;
          const email = user.email || `user${user.id}@myapi.local`;
          const displayName = user.display_name || user.username;

          // Create API token for this user
          const apiKey = await createApiToken(user.id, `xbb-desktop-${email}`);

          const auth: AuthUser = {
            email,
            name: displayName,
            myapiUserId: user.id,
            myapiApiKey: apiKey,
            myapiBaseUrl: MYAPI_BASE,
            loggedInAt: Date.now(),
          };

          saveAuth(auth);
          authWindow.close();
          logger.remote('user-login', 'info', `User logged in via OIDC: ${email}`);
          resolve(auth);
          return;
        }
      }

      // If we got here with a session cookie, use it
      if (sessionCookie) {
        const userResp = await httpRequest(`${MYAPI_BASE}/api/user/self`, {
          headers: { 'Cookie': `session=${sessionCookie.value}` },
        });
        const userData = JSON.parse(userResp.body);

        if (userData.success && userData.data) {
          const user = userData.data;
          const email = user.email || `user${user.id}@myapi.local`;
          const displayName = user.display_name || user.username;

          const apiKey = await createApiToken(user.id, `xbb-desktop-${email}`);

          const auth: AuthUser = {
            email,
            name: displayName,
            myapiUserId: user.id,
            myapiApiKey: apiKey,
            myapiBaseUrl: MYAPI_BASE,
            loggedInAt: Date.now(),
          };

          saveAuth(auth);
          authWindow.close();
          logger.remote('user-login', 'info', `User logged in via OIDC: ${email}`);
          resolve(auth);
          return;
        }
      }
    } catch (e: any) {
      logger.error('AUTH', 'OIDC callback handling failed:', e.message);
      reject(e);
      authWindow.close();
    }
  }
}
