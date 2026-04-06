import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Customer config — edit these values per deployment
const CONFIG = {
  apiBaseUrl: 'https://pikkapi.cooltechgp.online',
  apiKey: 'sk-yUzZKUMi983ugkXrvhd1FfNU72Gjq4bTuTVqHMRxd43KnYE3',
  model: 'opus[1m]',
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

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:4200');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../browser/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ============ HELPERS ============

// Get the correct home directory (even when running as sudo)
function getHomeDir(): string {
  return process.env.SUDO_USER
    ? path.join('/home', process.env.SUDO_USER)
    : os.homedir();
}

// Write Claude Code settings — matches cc-pika-install format exactly
function configureClaudeSettings(apiBaseUrl: string, apiKey: string) {
  const claudeDir = path.join(getHomeDir(), '.claude');
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });

  const settingsPath = path.join(claudeDir, 'settings.json');

  const settings = {
    env: {
      ANTHROPIC_BASE_URL: apiBaseUrl,
      ANTHROPIC_AUTH_TOKEN: apiKey,
    },
    permissions: {
      allow: ['Bash(env:*)'],
      defaultMode: 'bypassPermissions',
    },
    model: CONFIG.model,
    skipDangerousModePermissionPrompt: true,
    hasCompletedOnboarding: true,
    hasAcknowledgedDisclaimer: true,
  };

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

// Find claude binary path
function findClaudeBinary(): string | null {
  try {
    if (process.platform === 'win32') {
      return execSync('where claude', { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0];
    } else {
      return execSync('which claude', { encoding: 'utf8', timeout: 5000 }).trim();
    }
  } catch {
    // Check common install locations
    const locations = process.platform === 'win32'
      ? [
          path.join(getHomeDir(), '.claude', 'local', 'claude.exe'),
          path.join(getHomeDir(), 'AppData', 'Local', 'Programs', 'claude-code', 'claude.exe'),
          path.join(getHomeDir(), '.local', 'bin', 'claude.exe'),
        ]
      : [
          path.join(getHomeDir(), '.claude', 'local', 'claude'),
          path.join(getHomeDir(), '.local', 'bin', 'claude'),
          '/usr/local/bin/claude',
        ];

    for (const loc of locations) {
      if (fs.existsSync(loc)) return loc;
    }
    return null;
  }
}

// ============ IPC HANDLERS ============

// Check if a CLI tool is installed
ipcMain.handle('check-tool', async (_, tool: string) => {
  try {
    if (tool === 'claude') {
      const bin = findClaudeBinary();
      if (bin) {
        const version = execSync(`"${bin}" --version 2>&1`, { encoding: 'utf8', timeout: 10000 });
        return { installed: true, version: version.trim().split('\n')[0] };
      }
      return { installed: false, version: null };
    }
    const version = execSync(`${tool} --version 2>&1`, { encoding: 'utf8', timeout: 10000 });
    return { installed: true, version: version.trim().split('\n')[0] };
  } catch {
    return { installed: false, version: null };
  }
});

// Install Claude Code — native binary (no Node.js/npm needed)
ipcMain.handle('install-claude', async (event, apiBaseUrl: string, apiKey: string) => {
  const send = (msg: string) => mainWindow?.webContents.send('install-progress', { tool: 'claude', output: msg + '\n' });

  try {
    // Step 1: Check if already installed
    const existingBin = findClaudeBinary();
    if (existingBin) {
      try {
        const version = execSync(`"${existingBin}" --version`, { encoding: 'utf8', timeout: 10000 });
        send('Claude Code already installed: ' + version.trim());
      } catch {
        send('Claude Code binary found at: ' + existingBin);
      }
      configureClaudeSettings(apiBaseUrl, apiKey);
      send('✅ Configuration updated with your API settings.');
      return { success: true, output: 'Already installed and configured' };
    }

    // Step 2: Download and install native binary
    send('📦 Downloading Claude Code...');

    if (process.platform === 'win32') {
      // Windows: use PowerShell to download and run installer
      send('Downloading installer for Windows...');
      try {
        execSync(
          'powershell -ExecutionPolicy Bypass -Command "& { Invoke-WebRequest -Uri \'https://claude.ai/install.ps1\' -OutFile \'$env:TEMP\\claude-install.ps1\'; & \'$env:TEMP\\claude-install.ps1\' }"',
          { encoding: 'utf8', timeout: 180000 } as any
        );
      } catch {
        // Fallback: try direct download of the binary
        send('PowerShell installer failed. Trying direct download...');
        const downloadDir = path.join(getHomeDir(), '.claude', 'downloads');
        if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
        execSync(
          `powershell -Command "Invoke-WebRequest -Uri 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest/win32-x64/claude' -OutFile '${path.join(downloadDir, 'claude.exe')}';"`,
          { encoding: 'utf8', timeout: 180000 } as any
        );
        // Make accessible
        const localBin = path.join(getHomeDir(), '.local', 'bin');
        if (!fs.existsSync(localBin)) fs.mkdirSync(localBin, { recursive: true });
        fs.copyFileSync(path.join(downloadDir, 'claude.exe'), path.join(localBin, 'claude.exe'));
      }
    } else if (process.platform === 'darwin') {
      // Mac: use native installer
      send('Downloading installer for macOS...');
      execSync('curl -fsSL https://claude.ai/install.sh | sh', {
        encoding: 'utf8',
        timeout: 180000,
        shell: '/bin/bash',
      } as any);
    } else {
      // Linux: use native installer
      send('Downloading installer for Linux...');
      execSync('curl -fsSL https://claude.ai/install.sh | sh', {
        encoding: 'utf8',
        timeout: 180000,
        shell: '/bin/bash',
      } as any);
    }

    send('✅ Claude Code installed!');

    // Step 3: Configure settings.json
    send('⚙️ Configuring API settings...');
    configureClaudeSettings(apiBaseUrl, apiKey);
    send('✅ Configuration complete! API URL and key set.');

    return { success: true, output: 'Installed and configured' };
  } catch (e: any) {
    send('❌ Installation failed: ' + e.message);
    return { success: false, output: e.message };
  }
});

// Install OpenClaw — try multiple methods, no system Node.js required
ipcMain.handle('install-openclaw', async () => {
  const send = (msg: string) => mainWindow?.webContents.send('install-progress', { tool: 'openclaw', output: msg + '\n' });

  try {
    // Check if already installed
    try {
      const version = execSync('openclaw --version', { encoding: 'utf8', timeout: 10000 });
      send('✅ OpenClaw already installed: ' + version.trim());
      return { success: true, output: 'Already installed' };
    } catch { /* not installed */ }

    send('📦 Installing OpenClaw...');

    // Method 1: Try system npm
    try {
      send('Trying system npm...');
      execSync('npm install -g openclaw', {
        encoding: 'utf8',
        timeout: 180000,
      } as any);
      send('✅ OpenClaw installed!');
      return { success: true, output: 'Installed via system npm' };
    } catch {
      send('System npm not available.');
    }

    // Method 2: Use Electron's bundled Node.js to run npm
    try {
      send('Using bundled Node.js...');
      const electronNode = process.execPath;
      // Find npm relative to Electron's node
      const npmScript = path.join(path.dirname(electronNode), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (fs.existsSync(npmScript)) {
        execSync(`"${electronNode}" "${npmScript}" install -g openclaw`, {
          encoding: 'utf8',
          timeout: 180000,
        } as any);
        send('✅ OpenClaw installed via bundled Node!');
        return { success: true, output: 'Installed via bundled Node' };
      }
    } catch {
      send('Bundled npm not available.');
    }

    // Method 3: Download OpenClaw directly via curl/PowerShell
    try {
      send('Trying direct npm package download...');
      if (process.platform === 'win32') {
        execSync('powershell -Command "npm install -g openclaw"', {
          encoding: 'utf8',
          timeout: 180000,
        } as any);
      } else {
        // Last resort: check if npx is available from any source
        execSync('npx -y openclaw --version', {
          encoding: 'utf8',
          timeout: 180000,
        } as any);
      }
      send('✅ OpenClaw installed!');
      return { success: true, output: 'Installed' };
    } catch {
      send('All methods failed.');
    }

    return {
      success: false,
      output: 'Could not install OpenClaw. Please install Node.js from https://nodejs.org and try again.',
    };
  } catch (e: any) {
    send('❌ Installation failed: ' + e.message);
    return { success: false, output: e.message };
  }
});

// Get customer config
ipcMain.handle('get-config', async () => {
  return CONFIG;
});

// Chat with Claude Code (streaming)
ipcMain.handle('claude-chat', async (event, message: string, workDir: string) => {
  return new Promise((resolve) => {
    // Find Claude binary
    const claudeBin = findClaudeBinary() || 'claude';
    const targetDir = workDir || path.join(getHomeDir(), '.openclaw');

    const args = [
      '-p', message,
      '--print',
      '--output-format', 'stream-json',
      '--permission-mode', 'bypassPermissions',
      '--allowedTools', 'Read,Edit,Write,Bash,Glob,Grep',
      '-d', targetDir,
    ];

    const proc = spawn(claudeBin, args, {
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: CONFIG.apiBaseUrl,
        ANTHROPIC_AUTH_TOKEN: CONFIG.apiKey,
      },
      cwd: targetDir,
    });

    let fullOutput = '';

    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          mainWindow?.webContents.send('claude-stream', parsed);
          if (parsed.type === 'assistant' && parsed.content) {
            fullOutput += typeof parsed.content === 'string'
              ? parsed.content
              : parsed.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
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

// Get OpenClaw status
ipcMain.handle('openclaw-status', async () => {
  try {
    const out = execSync('openclaw channels status 2>&1', { encoding: 'utf8', timeout: 15000 });
    const whatsapp = out.includes('connected') ? 'connected' : out.includes('disconnected') ? 'disconnected' : 'unknown';
    return { gateway: true, whatsapp, raw: out };
  } catch {
    return { gateway: false, whatsapp: 'unknown', raw: '' };
  }
});

// Restart OpenClaw
ipcMain.handle('openclaw-restart', async () => {
  try {
    execSync('openclaw daemon restart 2>&1', { encoding: 'utf8', timeout: 15000 });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});
