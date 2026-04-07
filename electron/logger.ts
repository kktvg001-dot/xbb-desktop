// File-based logger for xbb-desktop
// Logs to ~/.xbb-desktop/logs/ with daily rotation

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const LOG_DIR = path.join(os.homedir(), '.xbb-desktop', 'logs');
const MAX_LOG_FILES = 7; // Keep 7 days of logs
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file

// Ensure log directory exists
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
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
    // Check size — rotate if too big
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
    // Remove old files beyond MAX_LOG_FILES
    for (const f of files.slice(MAX_LOG_FILES)) {
      try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch {}
    }
  } catch {}
}

// Run cleanup on startup
cleanup();

// ── Public API ──────────────────────────────────────────────────

export function log(tag: string, ...args: any[]): void {
  const entry = formatEntry('INFO', tag, ...args);
  process.stdout.write(entry);
  writeToFile(entry);
}

export function warn(tag: string, ...args: any[]): void {
  const entry = formatEntry('WARN', tag, ...args);
  process.stderr.write(entry);
  writeToFile(entry);
}

export function error(tag: string, ...args: any[]): void {
  const entry = formatEntry('ERROR', tag, ...args);
  process.stderr.write(entry);
  writeToFile(entry);
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
