#!/usr/bin/env node
// xbb-desktop backend — log receiver + auth provisioning
// Runs on port 4080 (xbb.cooltechgp.online)
//
// The admin token stays HERE on the server — never in the desktop app.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PORT = 4080;
const LOG_DIR = path.join(__dirname, 'received-logs');
const MAX_BODY = 100 * 1024;

// ── Secrets (server-side only, never sent to client) ──
const MYAPI_BASE = 'http://localhost:3031';  // DEV instance, local access
const ADMIN_TOKEN = 'P+96k2x9dyqcFOxwyOVPtkykC53C52yI';
const ADMIN_USER_ID = '1';
// App secret — shared between desktop app and this server to prove request is from our app
const APP_SECRET = 'xbb-provision-2026-c7f3a9';

fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFile() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `remote-${date}.log`);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── HTTP helper for calling myapi ─────────────────────
function myapiRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, MYAPI_BASE);
    const req = http.request(url, {
      method,
      headers: {
        'Authorization': ADMIN_TOKEN,
        'New-Api-User': ADMIN_USER_ID,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid JSON from myapi'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('myapi timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function myapiRequestAsUser(method, endpoint, userId, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, MYAPI_BASE);
    const req = http.request(url, {
      method,
      headers: {
        'Authorization': ADMIN_TOKEN,
        'New-Api-User': String(userId),
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid JSON from myapi'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('myapi timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Verify Google token ───────────────────────────────
function verifyGoogleToken(idToken) {
  return new Promise((resolve, reject) => {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          if (info.error_description) {
            reject(new Error(info.error_description));
          } else if (!info.email) {
            reject(new Error('No email in token'));
          } else {
            resolve({ email: info.email, name: info.name || info.email.split('@')[0], picture: info.picture });
          }
        } catch { reject(new Error('Failed to parse Google response')); }
      });
    }).on('error', reject);
  });
}

// Get Google user info from access token
function getGoogleUserInfo(accessToken) {
  return new Promise((resolve, reject) => {
    https.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          if (!info.email) reject(new Error('No email in Google response'));
          else resolve({ email: info.email, name: info.name || info.email.split('@')[0], picture: info.picture });
        } catch { reject(new Error('Failed to parse Google response')); }
      });
    }).on('error', reject);
  });
}

// ── Find or create user on myapi ──────────────────────
async function findOrCreateUser(email, displayName) {
  // Search by email
  const searchResult = await myapiRequest('GET', `/api/user/search?keyword=${encodeURIComponent(email)}`);
  const users = searchResult?.data?.items || searchResult?.data || [];

  if (Array.isArray(users) && users.length > 0) {
    const existing = users.find(u => u.email === email);
    if (existing) return existing.id;
  }

  // Create new user
  const username = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '') + Math.random().toString(36).slice(2, 6);
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  let password = '';
  for (let i = 0; i < 16; i++) password += chars[Math.floor(Math.random() * chars.length)];

  const createResult = await myapiRequest('POST', '/api/user', {
    username,
    password,
    display_name: displayName || email.split('@')[0],
    email,
  });

  if (!createResult.success) throw new Error(createResult.message || 'Failed to create user');

  // Re-search to get the ID (create might not return it directly)
  const reSearch = await myapiRequest('GET', `/api/user/search?keyword=${encodeURIComponent(email)}`);
  const reUsers = reSearch?.data?.items || reSearch?.data || [];
  const found = Array.isArray(reUsers) ? reUsers.find(u => u.email === email) : null;
  if (found) return found.id;

  throw new Error('User created but could not retrieve ID');
}

// ── Create API token for user (direct DB) ─────────────
// The myapi API doesn't allow creating tokens for other users,
// so we insert directly into the database.
const DB_DSN = 'postgresql://root:123456@127.0.0.1:5432/new-api-my';

function dbQuery(sql) {
  const result = execSync(
    `docker exec postgres psql -U root -d new-api-my -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', timeout: 10000 }
  ).trim();
  return result;
}

function generateTokenKey() {
  // Same format as new-api: 48 random chars
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let key = '';
  const bytes = crypto.randomBytes(48);
  for (let i = 0; i < 48; i++) {
    key += chars[bytes[i] % chars.length];
  }
  return key;
}

function createApiToken(userId, tokenName) {
  // Check if token already exists
  const existing = dbQuery(
    `SELECT key FROM tokens WHERE user_id = ${userId} AND name = '${tokenName.replace(/'/g, "''")}' AND status = 1 AND deleted_at IS NULL LIMIT 1`
  );
  if (existing) {
    return existing.startsWith('sk-') ? existing : 'sk-' + existing;
  }

  // Create new token
  const key = generateTokenKey();
  const now = Math.floor(Date.now() / 1000);
  dbQuery(
    `INSERT INTO tokens (user_id, name, key, status, created_time, accessed_time, expired_time, remain_quota, unlimited_quota, "group")
     VALUES (${userId}, '${tokenName.replace(/'/g, "''")}', '${key}', 1, ${now}, ${now}, -1, 0, true, 'default')`
  );

  return 'sk-' + key;
}

// ── Request body parser ───────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
    });
  });
}

// ── Main server ───────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // ── POST /api/auth/provision ─────────────────────
  // Desktop app sends Google access_token or id_token
  // Server verifies with Google, finds/creates user, creates API key
  // Returns { apiKey, baseUrl, email, name } — NO admin token exposed
  if (req.method === 'POST' && req.url === '/api/auth/provision') {
    try {
      const data = await parseBody(req);

      // Verify identity via one of these methods:
      // 1. app_secret + verified user data (from desktop app after OIDC login)
      // 2. Google access_token — verify with Google directly
      // 3. Google id_token — verify with Google tokeninfo
      let email, name, picture, userId;

      if (data.app_secret === APP_SECRET && data.myapi_user_id && data.verified_email) {
        // Desktop app verified user via myapi OIDC login + localStorage
        // The app_secret proves the request is from our app (not a random attacker)
        email = data.verified_email;
        name = data.verified_name || email.split('@')[0];
        userId = data.myapi_user_id;
      } else if (data.access_token) {
        const googleUser = await getGoogleUserInfo(data.access_token);
        email = googleUser.email;
        name = googleUser.name;
        picture = googleUser.picture;
        userId = await findOrCreateUser(email, name);
      } else if (data.id_token) {
        const googleUser = await verifyGoogleToken(data.id_token);
        email = googleUser.email;
        name = googleUser.name;
        picture = googleUser.picture;
        userId = await findOrCreateUser(email, name);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Missing authentication token' }));
      }

      console.log(`[${new Date().toISOString()}] Provisioning user: ${email}`);

      // Create API token
      const tokenName = `xbb-desktop-${email}`;
      const apiKey = await createApiToken(userId, tokenName);

      console.log(`[${new Date().toISOString()}] Provisioned: ${email} → userId=${userId}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: {
          email,
          name,
          picture,
          apiKey,
          baseUrl: 'https://myapi.cooltechgp.online',
          userId,
        },
      }));
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Provision error:`, e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // ── POST /api/xbb-logs ──────────────────────────
  if (req.method === 'POST' && req.url === '/api/xbb-logs') {
    try {
      const data = await parseBody(req);
      const entry = `\n=== ${data.ts || new Date().toISOString()} | ${data.device || 'unknown'} | ${data.platform || '?'}/${data.arch || '?'} ===\n`;
      const logs = (data.logs || []).join('\n') + '\n';
      fs.appendFileSync(getLogFile(), entry + logs);
      console.log(`[${new Date().toISOString()}] Received ${(data.logs || []).length} logs from ${data.device}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    } catch {
      res.writeHead(400);
      res.end('{"error":"invalid json"}');
    }
    return;
  }

  // ── GET /api/xbb-logs ──────────────────────────
  if (req.method === 'GET' && req.url === '/api/xbb-logs') {
    try {
      const content = fs.readFileSync(getLogFile(), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(content);
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('No logs yet today.');
    }
    return;
  }

  // ── GET / — dashboard ──────────────────────────
  const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log')).sort().reverse();
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>xbb-desktop Logs</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0}
body{font-family:-apple-system,system-ui,sans-serif;background:#0d0d0d;color:#e0e0e0;padding:24px;max-width:1000px;margin:0 auto}
h1{font-size:20px;margin-bottom:16px;color:#fff}
h3{font-size:14px;margin:20px 0 8px;color:#aaa}
.stats{display:flex;gap:16px;margin-bottom:20px}
.stat{background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:12px 16px;flex:1}
.stat-val{font-size:22px;font-weight:700;color:#fff}
.stat-label{font-size:11px;color:#888;margin-top:2px}
pre{background:#111;border:1px solid #222;border-radius:8px;padding:14px;font-size:11px;line-height:1.6;overflow-x:auto;max-height:500px;overflow-y:auto;white-space:pre-wrap;word-break:break-all}
.error-line{color:#f87171}
.warn-line{color:#fbbf24}
.info-line{color:#888}
.empty{text-align:center;color:#555;padding:40px}
.refresh{background:#222;border:1px solid #444;color:#ddd;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;margin-left:12px}
.refresh:hover{background:#333}
</style></head><body>
<h1>xbb-desktop Remote Logs <button class="refresh" onclick="location.reload()">Refresh</button></h1>
<div class="stats">
<div class="stat"><div class="stat-val">${files.length}</div><div class="stat-label">Log files</div></div>`;

  let todayCount = 0;
  let todayDevices = new Set();
  try {
    const today = fs.readFileSync(getLogFile(), 'utf-8');
    const deviceMatches = today.match(/\| ([^\|]+) \| /g) || [];
    deviceMatches.forEach(m => todayDevices.add(m.trim()));
    todayCount = (today.match(/^===/gm) || []).length;
  } catch {}

  html += `<div class="stat"><div class="stat-val">${todayCount}</div><div class="stat-label">Reports today</div></div>`;
  html += `<div class="stat"><div class="stat-val">${todayDevices.size}</div><div class="stat-label">Devices today</div></div>`;
  html += `</div>`;

  if (files.length === 0) {
    html += '<div class="empty">No logs received yet. Errors from desktop apps will appear here automatically.</div>';
  }

  for (const f of files.slice(0, 7)) {
    const content = fs.readFileSync(path.join(LOG_DIR, f), 'utf-8');
    const lines = content.split('\n').slice(-200);
    const highlighted = lines.map(l => {
      if (l.includes('[ERROR]')) return `<span class="error-line">${escapeHtml(l)}</span>`;
      if (l.includes('[WARN]')) return `<span class="warn-line">${escapeHtml(l)}</span>`;
      if (l.startsWith('===')) return `<span class="info-line">${escapeHtml(l)}</span>`;
      return escapeHtml(l);
    }).join('\n');
    html += `<h3>${f}</h3><pre>${highlighted}</pre>`;
  }

  html += '</body></html>';
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`xbb-desktop backend on http://0.0.0.0:${PORT}`);
  console.log(`Dashboard:  https://xbb.cooltechgp.online`);
  console.log(`Logs:       POST https://xbb.cooltechgp.online/api/xbb-logs`);
  console.log(`Provision:  POST https://xbb.cooltechgp.online/api/auth/provision`);
});
