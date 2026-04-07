#!/usr/bin/env node
// xbb-desktop remote log receiver
// Receives error logs from desktop app instances in real-time
// Runs on port 4080 (xbb.cooltechgp.online)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4080;
const LOG_DIR = path.join(__dirname, 'received-logs');
const MAX_BODY = 100 * 1024;

fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFile() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `remote-${date}.log`);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // POST /api/xbb-logs — receive logs from desktop apps
  if (req.method === 'POST' && req.url === '/api/xbb-logs') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
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
    });
    return;
  }

  // GET /api/xbb-logs — read today's raw logs
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

  // GET / — dashboard
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

  // Count today's entries
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
  console.log(`xbb-desktop log receiver on http://0.0.0.0:${PORT}`);
  console.log(`Dashboard: https://xbb.cooltechgp.online`);
  console.log(`Webhook:   POST https://xbb.cooltechgp.online/api/xbb-logs`);
});
