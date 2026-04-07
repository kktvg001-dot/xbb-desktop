// File-based logger for xbb-desktop
// Logs to ~/.xbb-desktop/logs/ with daily rotation
// Ships ERROR/WARN logs to remote server in real-time

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';

const LOG_DIR = path.join(os.homedir(), '.xbb-desktop', 'logs');
const MAX_LOG_FILES = 7;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// ── Remote logging config ─────────────────────────────────────
// Webhook URL to POST error logs to (set via setRemoteConfig)
let remoteWebhookUrl = '';
// Telegram bot for instant alerts
let telegramBotToken = '';
let telegramChatId = '';
// Device identifier (hostname + username)
const deviceId = `${os.hostname()}/${os.userInfo().username}`;
// Throttle: max 1 remote send per 10 seconds per tag
const lastRemoteSend = new Map<string, number>();
const REMOTE_THROTTLE_MS = 10_000;
// Buffer for batching
let remoteBuffer: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_INTERVAL_MS = 5_000;

// Ensure log directory exists
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `xbb-${date}.log`);
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatEntry(level: string, tag: string, ...args: any[]): string {
  const parts = args.map(a => {
    if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
    if (typeof a === 'object') {
      try { return JSON.stringify(a, null, 0); } catch { return String(a); }
    }
    return String(a);
  });
  return `[${timestamp()}] [${level}] [${tag}] ${parts.join(' ')}\n`;
}

function writeToFile(entry: string): void {
  try {
    const logPath = getLogFilePath();
    try {
      const stat = fs.statSync(logPath);
      if (stat.size > MAX_FILE_SIZE) {
        fs.renameSync(logPath, logPath.replace('.log', `-${Date.now()}.log`));
      }
    } catch {}
    fs.appendFileSync(logPath, entry, 'utf-8');
  } catch {}
}

function cleanup(): void {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('xbb-') && f.endsWith('.log'))
      .sort()
      .reverse();
    for (const f of files.slice(MAX_LOG_FILES)) {
      try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch {}
    }
  } catch {}
}

cleanup();

// ── Remote shipping (fire-and-forget) ─────────────────────────

function shouldSendRemote(tag: string): boolean {
  const now = Date.now();
  const last = lastRemoteSend.get(tag) || 0;
  if (now - last < REMOTE_THROTTLE_MS) return false;
  lastRemoteSend.set(tag, now);
  return true;
}

function httpPost(url: string, body: string): void {
  try {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(parsed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    });
    req.on('error', () => {}); // swallow
    req.write(body);
    req.end();
  } catch {}
}

function sendToWebhook(entries: string[]): void {
  if (!remoteWebhookUrl || entries.length === 0) return;
  const payload = JSON.stringify({
    device: deviceId,
    platform: process.platform,
    arch: process.arch,
    ts: timestamp(),
    logs: entries,
  });
  httpPost(remoteWebhookUrl, payload);
}

function sendToTelegram(entry: string): void {
  if (!telegramBotToken || !telegramChatId) return;
  // Truncate long messages for Telegram (4096 char limit)
  const maxLen = 3500;
  let text = `🖥 *xbb-desktop*\n📍 \`${deviceId}\`\n\n\`\`\`\n${entry.trim()}\n\`\`\``;
  if (text.length > maxLen) {
    text = text.slice(0, maxLen) + '\n...(truncated)```';
  }
  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
  const payload = JSON.stringify({
    chat_id: telegramChatId,
    text,
    parse_mode: 'Markdown',
    disable_notification: false,
  });
  httpPost(url, payload);
}

function queueRemote(entry: string, level: string, tag: string): void {
  // Always buffer for webhook batch
  remoteBuffer.push(entry.trim());
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const batch = remoteBuffer.splice(0);
      sendToWebhook(batch);
    }, FLUSH_INTERVAL_MS);
  }

  // Telegram: only ERROR level, throttled per tag
  if (level === 'ERROR' && shouldSendRemote(tag)) {
    sendToTelegram(entry);
  }
}

// ── Public API ──────────────────────────────────────────────────

/** Configure remote log shipping */
export function setRemoteConfig(config: {
  webhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}): void {
  if (config.webhookUrl !== undefined) remoteWebhookUrl = config.webhookUrl;
  if (config.telegramBotToken !== undefined) telegramBotToken = config.telegramBotToken;
  if (config.telegramChatId !== undefined) telegramChatId = config.telegramChatId;
}

export function log(tag: string, ...args: any[]): void {
  const entry = formatEntry('INFO', tag, ...args);
  process.stdout.write(entry);
  writeToFile(entry);
}

export function warn(tag: string, ...args: any[]): void {
  const entry = formatEntry('WARN', tag, ...args);
  process.stderr.write(entry);
  writeToFile(entry);
  queueRemote(entry, 'WARN', tag);
}

export function error(tag: string, ...args: any[]): void {
  const entry = formatEntry('ERROR', tag, ...args);
  process.stderr.write(entry);
  writeToFile(entry);
  queueRemote(entry, 'ERROR', tag);
}

/** Read today's log (or a specific date) — returns last N lines */
export function readLog(date?: string, maxLines = 200): string {
  try {
    const d = date || new Date().toISOString().slice(0, 10);
    const logPath = path.join(LOG_DIR, `xbb-${d}.log`);
    if (!fs.existsSync(logPath)) return '';
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');
    if (lines.length > maxLines) {
      return lines.slice(-maxLines).join('\n');
    }
    return content;
  } catch {
    return '';
  }
}

/** List available log files */
export function listLogs(): { date: string; size: number }[] {
  try {
    return fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('xbb-') && f.endsWith('.log'))
      .sort()
      .reverse()
      .map(f => {
        const stat = fs.statSync(path.join(LOG_DIR, f));
        const dateMatch = f.match(/xbb-(\d{4}-\d{2}-\d{2})/);
        return { date: dateMatch?.[1] || f, size: stat.size };
      });
  } catch {
    return [];
  }
}

/** Get the log directory path */
export function getLogDir(): string {
  return LOG_DIR;
}
