import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Customer config — edit these values per deployment
const CONFIG = {
  apiBaseUrl: 'https://pikkapi.cooltechgp.online',
  apiKey: 'sk-yUzZKUMi983ugkXrvhd1FfNU72Gjq4bTuTVqHMRxd43KnYE3',
};

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load Angular app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:4200');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../browser/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// IPC: Check if a CLI tool is installed
ipcMain.handle('check-tool', async (_, tool: string) => {
  try {
    const version = execSync(`${tool} --version 2>&1`, { encoding: 'utf8', timeout: 10000 });
    return { installed: true, version: version.trim().split('\n')[0] };
  } catch {
    return { installed: false, version: null };
  }
});

// IPC: Install a tool (legacy, kept for compatibility)
ipcMain.handle('install-tool', async (event, tool: string) => {
  const commands: Record<string, string> = {
    'claude': 'npm install -g @anthropic-ai/claude-code',
    'openclaw': 'npm install -g openclaw',
  };
  const cmd = commands[tool];
  if (!cmd) return { success: false, error: 'Unknown tool' };

  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', cmd], { env: process.env });
    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('close', (code) => {
      resolve({ success: code === 0, output });
    });
  });
});

// IPC: Install Claude Code via cc-pika-install (non-interactive)
ipcMain.handle('install-claude', async (event, apiBaseUrl: string, apiKey: string) => {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['cc-pika-install'], {
      env: {
        ...process.env,
        CC_PIKA_API_URL: apiBaseUrl,
        CC_PIKA_API_KEY: apiKey,
      },
      shell: true,
    });

    let output = '';
    proc.stdout.on('data', (d) => {
      const text = d.toString();
      output += text;
      mainWindow?.webContents.send('install-progress', { tool: 'claude', output: text });
      // Auto-respond to prompts
      if (text.includes('Base URL') || text.includes('base url') || text.includes('API Base')) {
        proc.stdin.write(apiBaseUrl + '\n');
      }
      if (text.includes('API key') || text.includes('api key') || text.includes('API Key')) {
        proc.stdin.write(apiKey + '\n');
      }
    });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('close', (code) => {
      resolve({ success: code === 0, output });
    });
  });
});

// IPC: Install OpenClaw
ipcMain.handle('install-openclaw', async () => {
  return new Promise((resolve) => {
    const proc = spawn('npm', ['install', '-g', 'openclaw'], { shell: true });
    let output = '';
    proc.stdout.on('data', (d) => {
      output += d.toString();
      mainWindow?.webContents.send('install-progress', { tool: 'openclaw', output: d.toString() });
    });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('close', (code) => {
      resolve({ success: code === 0, output });
    });
  });
});

// IPC: Get customer config (API URL + key)
ipcMain.handle('get-config', async () => {
  return CONFIG;
});

// IPC: Chat with Claude Code (streaming)
ipcMain.handle('claude-chat', async (event, message: string, workDir: string) => {
  const sessionId = 'xbb-desktop-session';

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      // Can override with proxy URL + API key here
    };

    const args = [
      '-p', message,
      '--print',
      '--output-format', 'stream-json',
      '--permission-mode', 'bypassPermissions',
      '--allowedTools', 'Read,Edit,Write,Bash,Glob,Grep',
      '-d', workDir || process.env.HOME + '/.openclaw',
    ];

    const proc = spawn('claude', args, { env, cwd: workDir });
    let fullOutput = '';

    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          // Send each chunk to renderer
          mainWindow?.webContents.send('claude-stream', parsed);
          if (parsed.type === 'assistant' && parsed.content) {
            fullOutput += typeof parsed.content === 'string' ? parsed.content :
              parsed.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
          }
        } catch {
          fullOutput += line;
        }
      }
    });

    proc.stderr.on('data', (d) => {
      mainWindow?.webContents.send('claude-stream', { type: 'error', content: d.toString() });
    });

    proc.on('close', (code) => {
      mainWindow?.webContents.send('claude-stream-end', { code });
      resolve({ success: code === 0, output: fullOutput });
    });
  });
});

// IPC: Get OpenClaw status
ipcMain.handle('openclaw-status', async () => {
  try {
    const out = execSync('openclaw channels status 2>&1', { encoding: 'utf8', timeout: 15000 });
    const whatsapp = out.includes('connected') ? 'connected' : out.includes('disconnected') ? 'disconnected' : 'unknown';
    return { gateway: true, whatsapp, raw: out };
  } catch {
    return { gateway: false, whatsapp: 'unknown', raw: '' };
  }
});

// IPC: Restart OpenClaw
ipcMain.handle('openclaw-restart', async () => {
  try {
    execSync('openclaw daemon restart 2>&1', { encoding: 'utf8', timeout: 15000 });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});
