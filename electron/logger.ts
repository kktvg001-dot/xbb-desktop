// File-based logger for xbb-desktop
// Local: logs everything to ~/.xbb-desktop/logs/
// Remote: only sends critical/actionable events to server

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';

const LOG_DIR = path.join(os.homedir(), '.xbb-desktop', 'logs');
const MAX_LOG_FILES = 7;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// ── Remote config ─────────────────────────────────────────────
let remoteWebhookUrl = '';
let telegramBotToken = '';
let telegramChatId = '';
const deviceId = `${os.hostname()}/${os.userInfo().username}`;
// Deduplicate: don't send the same event type more than once per 60s
const lastRemoteSend = new Map<string, number>();
const REMOTE_DEDUP_MS = 60_000;
// Batch buffer
let remoteBuffer: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_INTERVAL_MS = 10_000;
// Session counter for context
let appVersion = '';

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

// ── Remote shipping ───────────────────────────────────────────

function isDuplicate(key: string): boolean {
  const now = Date.now();
  const last = lastRemoteSend.get(key) || 0;
  if (now - last < REMOTE_DEDUP_MS) return true;
  lastRemoteSend.set(key, now);
  return false;
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
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch {}
}

function flushToWebhook(): void {
  if (!remoteWebhookUrl || remoteBuffer.length === 0) return;
  const batch = remoteBuffer.splice(0);
  const payload = JSON.stringify({
    device: deviceId,
    platform: process.platform,
    arch: process.arch,
    version: appVersion,
    ts: timestamp(),
    logs: batch,
  });
  httpPost(remoteWebhookUrl, payload);
}

function sendToTelegram(message: string): void {
  if (!telegramBotToken || !telegramChatId) return;
  const maxLen = 3500;
  let text = `🖥 *xbb-desktop*\n📍 \`${deviceId}\`\n\n\`\`\`\n${message.trim()}\n\`\`\``;
  if (text.length > maxLen) text = text.slice(0, maxLen) + '\n...(truncated)```';
  httpPost(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, JSON.stringify({
    chat_id: telegramChatId,
    text,
    parse_mode: 'Markdown',
  }));
}

// ── Public API ──────────────────────────────────────────────────

export function setRemoteConfig(config: {
  webhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  version?: string;
}): void {
  if (config.webhookUrl !== undefined) remoteWebhookUrl = config.webhookUrl;
  if (config.telegramBotToken !== undefined) telegramBotToken = config.telegramBotToken;
  if (config.telegramChatId !== undefined) telegramChatId = config.telegramChatId;
  if (config.version !== undefined) appVersion = config.version;
}

/** INFO — local file only, never shipped */
export function log(tag: string, ...args: any[]): void {
  const entry = formatEntry('INFO', tag, ...args);
  process.stdout.write(entry);
  writeToFile(entry);
}

/** WARN — local file only, never shipped */
export function warn(tag: string, ...args: any[]): void {
  const entry = formatEntry('WARN', tag, ...args);
  process.stderr.write(entry);
  writeToFile(entry);
}

/** ERROR — local file only, never shipped */
export function error(tag: string, ...args: any[]): void {
  const entry = formatEntry('ERROR', tag, ...args);
  process.stderr.write(entry);
  writeToFile(entry);
}

/**
 * REMOTE — ships to server. Use ONLY for actionable events:
 * - Repeated failures (ACP crash loop, connection failures)
 * - Unrecoverable errors (install failed, can't start)
 * - Key lifecycle events (app start, first chat success)
 *
 * @param eventKey - dedup key (e.g. 'acp-crash'). Same key won't re-send within 60s.
 * @param message - short, human-readable summary
 */
export function remote(eventKey: string, level: 'info' | 'warn' | 'error', message: string): void {
  // Always write locally too
  const entry = formatEntry(level.toUpperCase(), 'REMOTE', message);
  writeToFile(entry);
  if (level === 'error') process.stderr.write(entry);

  // Deduplicate
  if (isDuplicate(eventKey)) return;

  // Queue for webhook
  remoteBuffer.push(`[${level.toUpperCase()}] ${message}`);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushToWebhook();
    }, FLUSH_INTERVAL_MS);
  }

  // Telegram for errors only
  if (level === 'error') {
    sendToTelegram(message);
  }
}

/** Read today's log (or a specific date) */
export function readLog(date?: string, maxLines = 200): string {
  try {
    const d = date || new Date().toISOString().slice(0, 10);
    const logPath = path.join(LOG_DIR, `xbb-${d}.log`);
    if (!fs.existsSync(logPath)) return '';
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');
    if (lines.length > maxLines) return lines.slice(-maxLines).join('\n');
    return content;
  } catch { return ''; }
}

/** List available log files */
export function listLogs(): { date: string; size: number }[] {
  try {
    return fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('xbb-') && f.endsWith('.log'))
      .sort().reverse()
      .map(f => {
        const stat = fs.statSync(path.join(LOG_DIR, f));
        const dateMatch = f.match(/xbb-(\d{4}-\d{2}-\d{2})/);
        return { date: dateMatch?.[1] || f, size: stat.size };
      });
  } catch { return []; }
}

export function getLogDir(): string { return LOG_DIR; }
