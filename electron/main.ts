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

// Helper: Write Claude Code settings
function configureClaudeSettings(apiBaseUrl: string, apiKey: string) {
  const os = require('os');
  const claudeDir = path.join(os.homedir(), '.claude');
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });

  const settingsPath = path.join(claudeDir, 'settings.json');
  let settings: any = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}

  // Set API configuration
  settings.env = settings.env || {};
  settings.env.ANTHROPIC_BASE_URL = apiBaseUrl;
  settings.env.ANTHROPIC_API_KEY = apiKey;

  // Skip onboarding
  settings.permissions = settings.permissions || {};
  settings.permissions.allow = settings.permissions.allow || [];

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

// IPC: Install Claude Code — download native binary directly (no system Node.js required)
ipcMain.handle('install-claude', async (event, apiBaseUrl: string, apiKey: string) => {
  const send = (msg: string) => mainWindow?.webContents.send('install-progress', { tool: 'claude', output: msg + '\n' });

  try {
    // Step 1: Check if already installed
    try {
      const version = execSync('claude --version', { encoding: 'utf8', timeout: 10000 });
      send('Claude Code already installed: ' + version.trim());
      // Still configure the API
      configureClaudeSettings(apiBaseUrl, apiKey);
      send('Configuration updated.');
      return { success: true, output: 'Already installed and configured' };
    } catch { /* not installed, continue */ }

    // Step 2: Download native installer and run it
    send('Downloading Claude Code...');

    if (process.platform === 'win32') {
      // Windows: download and run the native installer
      execSync('powershell -Command "Invoke-WebRequest -Uri https://claude.ai/install.ps1 -OutFile $env:TEMP\\claude-install.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\\claude-install.ps1"', {
        encoding: 'utf8',
        timeout: 120000,
      });
    } else {
      // Mac/Linux: use the native install script
      execSync('curl -fsSL https://claude.ai/install.sh | sh', {
        encoding: 'utf8',
        timeout: 120000,
        shell: '/bin/bash',
      });
    }

    send('Claude Code installed!');

    // Step 3: Configure settings.json with proxy URL and API key
    configureClaudeSettings(apiBaseUrl, apiKey);
    send('Configuration complete!');

    return { success: true, output: 'Installed and configured' };
  } catch (e: any) {
    return { success: false, output: e.message };
  }
});

// IPC: Install OpenClaw — uses Electron's bundled Node.js, no system npm required
ipcMain.handle('install-openclaw', async () => {
  const send = (msg: string) => mainWindow?.webContents.send('install-progress', { tool: 'openclaw', output: msg + '\n' });

  try {
    // Check if already installed
    try {
      const version = execSync('openclaw --version', { encoding: 'utf8', timeout: 10000 });
      send('OpenClaw already installed: ' + version.trim());
      return { success: true, output: 'Already installed' };
    } catch { /* not installed */ }

    send('Installing OpenClaw...');

    // Try system npm first
    try {
      const result = execSync('npm install -g openclaw', {
        encoding: 'utf8',
        timeout: 120000,
        shell: true,
        env: { ...process.env, PATH: process.env.PATH },
      });
      send('OpenClaw installed!');
      return { success: true, output: result };
    } catch {
      send('npm not found in system PATH. Trying Electron bundled Node...');
    }

    // Fallback: use Electron's own Node.js process to run npm
    const result = execSync(`"${process.execPath}" -e "require('child_process').execSync('npm install -g openclaw', {stdio:'inherit'})"`, {
      encoding: 'utf8',
      timeout: 120000,
      shell: true,
    });
    send('OpenClaw installed via bundled Node!');
    return { success: true, output: result || 'Installed via bundled Node' };
  } catch (e: any) {
    return { success: false, output: 'Failed: ' + e.message + '\n\nPlease install Node.js from https://nodejs.org and try again.' };
  }
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
