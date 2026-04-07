import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron';
import { spawn, execSync, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import { AcpConnection, StreamChunk } from './acp';

// ============ GLOBAL ERROR HANDLERS ============
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Don't crash — just log
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

// Customer config — edit these values per deployment
const CONFIG = {
  apiBaseUrl: 'https://pikkapi.cooltechgp.online',
  apiKey: 'sk-yUzZKUMi983ugkXrvhd1FfNU72Gjq4bTuTVqHMRxd43KnYE3',
  model: 'opus[1m]',
};

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ACP connection state — persistent across messages
let acpConnection: AcpConnection | null = null;
let lastSessionId: string | null = null;

// Persist sessionId to disk for cross-restart resume
const SESSION_FILE = path.join(os.homedir(), '.xbb-desktop', '.acp-session');

function saveSessionId(id: string) {
  try {
    const dir = path.dirname(SESSION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_FILE, id, 'utf8');
  } catch {}
}

function loadSessionId(): string | null {
  try {
    if (fs.existsSync(SESSION_FILE)) return fs.readFileSync(SESSION_FILE, 'utf8').trim();
  } catch {}
  return null;
}

// ============ AUTO-START ON BOOT ============
app.setLoginItemSettings({
  openAtLogin: true,
  openAsHidden: true, // Start minimized to tray
});

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
    // Try multiple paths — structure differs between dev build and packaged app
    const possiblePaths = [
      path.join(__dirname, '../browser/index.html'),           // dev build: dist/electron/../browser/
      path.join(__dirname, '../../dist/browser/index.html'),   // alt dev
      path.join(app.getAppPath(), 'dist/browser/index.html'),  // packaged app
      path.join(app.getAppPath(), 'browser/index.html'),       // packaged flat
    ];
    const indexPath = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
    mainWindow.loadFile(indexPath);
  }

  // Close button minimizes to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

// ============ SYSTEM TRAY ============
function createTray() {
  // Create tray icon (green circle for OpenClaw)
  const iconSize = 16;
  const icon = nativeImage.createEmpty();

  // Try to load icon from build directory
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  if (fs.existsSync(iconPath)) {
    tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: iconSize, height: iconSize }));
  } else {
    // Fallback: create a simple colored icon programmatically
    tray = new Tray(nativeImage.createEmpty());
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '📊 Open Dashboard',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: '🔄 Restart OpenClaw',
      click: () => {
        exec('openclaw daemon restart 2>&1', { timeout: 15000, windowsHide: true }, () => {});
      },
    },
    {
      label: '⏹️ Stop OpenClaw',
      click: () => {
        exec('openclaw daemon stop 2>&1', { timeout: 15000, windowsHide: true }, () => {});
      },
    },
    { type: 'separator' },
    {
      label: '❌ Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('OpenClaw Assistant');
  tray.setContextMenu(contextMenu);

  // Double-click tray icon opens the window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // If launched at login (hidden), hide the window
  if (app.getLoginItemSettings().wasOpenedAsHidden) {
    mainWindow?.hide();
  }
});

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
  // Only quit on Mac if isQuitting
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  // Tear down ACP connection on quit
  if (acpConnection) {
    acpConnection.disconnect().catch(() => {});
    acpConnection = null;
  }
});

// ============ HELPERS ============

function getHomeDir(): string {
  return process.env.SUDO_USER
    ? path.join('/home', process.env.SUDO_USER)
    : os.homedir();
}

function sendProgress(tool: string, msg: string) {
  mainWindow?.webContents.send('install-progress', { tool, output: msg + '\n' });
}

// Check if a command exists in system PATH (async — does not block main thread)
function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    exec(checkCmd, { timeout: 3000, windowsHide: true }, (err) => resolve(!err));
  });
}

// Find claude binary (checks known locations first, then PATH async)
async function findClaudeBinary(): Promise<string | null> {
  // Check known locations first (instant, no exec)
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
  // Then check PATH (async)
  if (await commandExists('claude')) return 'claude';
  return null;
}

// Write Claude Code settings — matches cc-pika-install format exactly
function configureClaudeSettings() {
  const claudeDir = path.join(getHomeDir(), '.claude');
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });

  const settings = {
    env: {
      ANTHROPIC_BASE_URL: CONFIG.apiBaseUrl,
      ANTHROPIC_AUTH_TOKEN: CONFIG.apiKey,
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

  fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(settings, null, 2));
}

// Download a file to a local path
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(response.headers.location!, dest).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { fs.unlinkSync(dest); reject(err); });
  });
}

// ============ IPC: CHECK TOOLS ============

ipcMain.handle('check-tool', async (_, tool: string) => {
  const execAsync = (cmd: string, timeout: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      exec(cmd, { encoding: 'utf8', timeout, windowsHide: true }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
  };

  try {
    if (tool === 'claude') {
      const bin = await findClaudeBinary();
      if (!bin) return { installed: false, version: null };
      const version = await execAsync(`"${bin}" --version 2>&1`, 10000);
      return { installed: true, version: version.trim().split('\n')[0] };
    }
    if (tool === 'node') {
      const version = await execAsync('node --version 2>&1', 5000);
      return { installed: true, version: version.trim() };
    }
    if (tool === 'openclaw') {
      const version = await execAsync('openclaw --version 2>&1', 10000);
      return { installed: true, version: version.trim().split('\n')[0] };
    }
    return { installed: false, version: null };
  } catch {
    return { installed: false, version: null };
  }
});

// ============ IPC: INSTALL NODE.JS ============
// Node.js is required for OpenClaw. Install it silently if missing.

ipcMain.handle('install-nodejs', async () => {
  const send = (msg: string) => sendProgress('nodejs', msg);

  try {
    // Check if already installed
    if (await commandExists('node')) {
      try {
        const version = execSync('node --version', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
        send('✅ Node.js already installed: ' + version);
        return { success: true, output: version };
      } catch {}
    }

    send('📦 Installing Node.js...');
    const tmpDir = os.tmpdir();

    if (process.platform === 'win32') {
      // Windows: download Node.js MSI and install silently
      send('Downloading Node.js for Windows...');
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const msiUrl = `https://nodejs.org/dist/v22.12.0/node-v22.12.0-${arch}.msi`;
      const msiPath = path.join(tmpDir, 'node-installer.msi');

      await downloadFile(msiUrl, msiPath);
      send('Downloaded. Installing silently (this may take a minute)...');

      execSync(`msiexec /i "${msiPath}" /quiet /norestart`, {
        timeout: 300000,
        stdio: 'pipe',
        windowsHide: true,
      } as any);

      // Clean up
      try { fs.unlinkSync(msiPath); } catch {}

      // Refresh PATH — Node.js MSI installs to C:\Program Files\nodejs\
      const nodePaths = [
        'C:\\Program Files\\nodejs',
        path.join(getHomeDir(), 'AppData', 'Roaming', 'npm'),
      ];
      for (const p of nodePaths) {
        if (fs.existsSync(p) && !process.env.PATH?.includes(p)) {
          process.env.PATH = p + ';' + process.env.PATH;
        }
      }
      send('✅ Node.js installed!');

    } else if (process.platform === 'darwin') {
      // Mac: download Node.js PKG and install
      send('Downloading Node.js for macOS...');
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const pkgUrl = `https://nodejs.org/dist/v22.12.0/node-v22.12.0-${arch}.pkg`;
      const pkgPath = path.join(tmpDir, 'node-installer.pkg');

      await downloadFile(pkgUrl, pkgPath);
      send('Downloaded. Installing (may ask for your password)...');

      execSync(`sudo installer -pkg "${pkgPath}" -target /`, {
        timeout: 300000,
        stdio: 'pipe',
      } as any);

      try { fs.unlinkSync(pkgPath); } catch {}

      // Refresh PATH for Mac
      const macPaths = ['/usr/local/bin', '/opt/homebrew/bin'];
      for (const p of macPaths) {
        if (!process.env.PATH?.includes(p)) {
          process.env.PATH = p + ':' + process.env.PATH;
        }
      }
      send('✅ Node.js installed!');

    } else {
      // Linux
      send('Downloading Node.js for Linux...');
      execSync('curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs', {
        encoding: 'utf8',
        timeout: 300000,
        shell: '/bin/bash',
      } as any);
      send('✅ Node.js installed!');
    }

    return { success: true, output: 'Installed' };
  } catch (e: any) {
    send('❌ Failed to install Node.js: ' + e.message);
    return { success: false, output: e.message };
  }
});

// ============ IPC: INSTALL CLAUDE CODE ============
// Uses native installer (no Node.js required)

ipcMain.handle('install-claude', async () => {
  const send = (msg: string) => sendProgress('claude', msg);

  try {
    // Check if already installed
    const existingBin = await findClaudeBinary();
    if (existingBin) {
      try {
        const version = execSync(`"${existingBin}" --version`, { encoding: 'utf8', timeout: 10000, windowsHide: true });
        send('✅ Claude Code already installed: ' + version.trim());
      } catch {
        send('✅ Claude Code found at: ' + existingBin);
      }
      configureClaudeSettings();
      send('⚙️ API configuration updated.');
      return { success: true, output: 'Already installed' };
    }

    send('📦 Downloading Claude Code...');

    if (process.platform === 'win32') {
      // Windows: download native binary via PowerShell
      send('Downloading for Windows...');
      execSync(
        'powershell -ExecutionPolicy Bypass -Command "& { $script = Invoke-WebRequest -Uri \'https://claude.ai/install.ps1\' -UseBasicParsing; Invoke-Expression $script.Content }"',
        { timeout: 180000, stdio: 'pipe', windowsHide: true } as any
      );
    } else {
      // Mac/Linux: native install script
      send('Downloading for ' + (process.platform === 'darwin' ? 'macOS' : 'Linux') + '...');
      execSync('curl -fsSL https://claude.ai/install.sh | sh', {
        timeout: 180000,
        shell: '/bin/bash',
        stdio: 'pipe',
      } as any);
    }

    send('✅ Claude Code installed!');

    // Configure API settings
    send('⚙️ Configuring API settings...');
    configureClaudeSettings();
    send('✅ Configuration complete!');

    return { success: true, output: 'Installed and configured' };
  } catch (e: any) {
    send('❌ Failed: ' + e.message);
    return { success: false, output: e.message };
  }
});

// ============ IPC: INSTALL OPENCLAW ============
// Requires Node.js (installed in previous step)

ipcMain.handle('install-openclaw', async () => {
  const send = (msg: string) => sendProgress('openclaw', msg);

  try {
    // Check if already installed
    if (await commandExists('openclaw')) {
      try {
        const version = execSync('openclaw --version', { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim();
        send('✅ OpenClaw already installed: ' + version);
        return { success: true, output: version };
      } catch {}
    }

    // Find npm — check PATH (including freshly installed Node.js locations)
    let npmCmd = 'npm';
    if (!(await commandExists('npm'))) {
      // Try known locations after fresh install
      const npmLocations = process.platform === 'win32'
        ? ['C:\\Program Files\\nodejs\\npm.cmd', path.join(getHomeDir(), 'AppData', 'Roaming', 'npm', 'npm.cmd')]
        : ['/usr/local/bin/npm', '/opt/homebrew/bin/npm', '/usr/bin/npm'];

      const found = npmLocations.find(p => fs.existsSync(p));
      if (found) {
        npmCmd = `"${found}"`;
        send('Found npm at: ' + found);
      } else {
        send('❌ npm not found. Please restart the app after Node.js installation.');
        return { success: false, output: 'npm not found. Restart app and try again.' };
      }
    }

    send('📦 Installing OpenClaw via npm...');

    if (process.platform === 'win32') {
      execSync(`${npmCmd} install -g openclaw`, { timeout: 180000, stdio: 'pipe', env: process.env, windowsHide: true } as any);
    } else {
      try {
        execSync(`${npmCmd} install -g openclaw`, { timeout: 180000, stdio: 'pipe', env: process.env } as any);
      } catch {
        send('Retrying with elevated permissions...');
        execSync(`sudo ${npmCmd} install -g openclaw`, { timeout: 180000, stdio: 'pipe', env: process.env } as any);
      }
    }

    send('✅ OpenClaw installed!');
    return { success: true, output: 'Installed' };
  } catch (e: any) {
    send('❌ Failed: ' + e.message);
    return { success: false, output: e.message };
  }
});

// ============ IPC: GET CONFIG ============

ipcMain.handle('get-config', async () => ({
  ...CONFIG,
  homeDir: getHomeDir(),
  defaultWorkspace: getHomeDir(),
}));

// ============ IPC: ACP CONNECTION MANAGEMENT ============

ipcMain.handle('claude-connect', async (_, workDir: string) => {
  try {
    const targetDir = workDir || getHomeDir();
    if (!fs.existsSync(targetDir)) {
      try { fs.mkdirSync(targetDir, { recursive: true }); } catch {}
    }

    // Tear down existing connection if any
    if (acpConnection) {
      await acpConnection.disconnect();
      acpConnection = null;
    }

    acpConnection = new AcpConnection();

    // Wire up streaming — send clean typed chunks to renderer
    acpConnection.onStreamChunk = (chunk: StreamChunk) => {
      mainWindow?.webContents.send('claude-stream', chunk);
    };

    acpConnection.onError = (err: string) => {
      mainWindow?.webContents.send('claude-stream', { type: 'error', content: err });
    };

    acpConnection.onDisconnect = (info) => {
      mainWindow?.webContents.send('claude-stream', {
        type: 'error',
        content: `ACP process disconnected (code: ${info.code}, signal: ${info.signal})`,
      });
    };

    // Connect with API keys injected into spawn environment
    await acpConnection.connect(targetDir, {
      ANTHROPIC_BASE_URL: CONFIG.apiBaseUrl,
      ANTHROPIC_AUTH_TOKEN: CONFIG.apiKey,
    });

    // Try to resume previous session, or create new one
    const savedSession = loadSessionId();
    const sessionId = await acpConnection.newSession(targetDir, savedSession || undefined);
    lastSessionId = sessionId;
    saveSessionId(sessionId);

    return { success: true, sessionId };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('claude-disconnect', async () => {
  if (acpConnection) {
    await acpConnection.disconnect();
    acpConnection = null;
  }
  return { success: true };
});

ipcMain.handle('claude-cancel', async () => {
  if (acpConnection && acpConnection.isConnected()) {
    acpConnection.cancelPrompt();
    return { success: true };
  }
  return { success: false, error: 'No active connection' };
});

// ============ IPC: CLAUDE CHAT (streaming via ACP) ============

ipcMain.handle('claude-chat', async (_event, message: string, workDir: string, imageBase64?: string) => {
  try {
    // Default to user's home directory — NOT .openclaw (this is just a Claude Code chat)
    const targetDir = workDir || getHomeDir();
    if (!fs.existsSync(targetDir)) {
      try { fs.mkdirSync(targetDir, { recursive: true }); } catch {}
    }

    // Auto-connect if not already connected
    if (!acpConnection || !acpConnection.isConnected()) {
      acpConnection = new AcpConnection();

      // Wire up streaming — clean typed chunks to renderer
      acpConnection.onStreamChunk = (chunk: StreamChunk) => {
        mainWindow?.webContents.send('claude-stream', chunk);
      };

      acpConnection.onError = (err: string) => {
        mainWindow?.webContents.send('claude-stream', { type: 'error', content: err });
      };

      acpConnection.onDisconnect = (info) => {
        mainWindow?.webContents.send('claude-stream', {
          type: 'error',
          content: `ACP process disconnected (code: ${info.code}, signal: ${info.signal})`,
        });
      };

      // Connect with API keys in spawn environment
      await acpConnection.connect(targetDir, {
        ANTHROPIC_BASE_URL: CONFIG.apiBaseUrl,
        ANTHROPIC_AUTH_TOKEN: CONFIG.apiKey,
      });

      // Create fresh session (don't try resume — it causes issues)
      const sessionId = await acpConnection.newSession(targetDir);
      lastSessionId = sessionId;
      saveSessionId(sessionId);
    }

    // Send the prompt — ACP streams updates via onStreamChunk callback
    await acpConnection.sendPrompt(message, imageBase64);

    // Signal completion to renderer
    mainWindow?.webContents.send('claude-stream', { type: 'done' });
    mainWindow?.webContents.send('claude-stream-end', { code: 0 });
    return { success: true, sessionId: lastSessionId };
  } catch (e: any) {
    mainWindow?.webContents.send('claude-stream', { type: 'error', content: e.message });
    mainWindow?.webContents.send('claude-stream-end', { code: 1 });
    return { success: false, output: e.message };
  }
});

// ============ IPC: OPENCLAW STATUS ============

ipcMain.handle('openclaw-status', async () => {
  return new Promise((resolve) => {
    exec('openclaw channels status 2>&1', { encoding: 'utf8', timeout: 10000, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve({ gateway: false, whatsapp: 'unknown', raw: '' });
        return;
      }
      const whatsapp = stdout.includes('connected') ? 'connected' : stdout.includes('disconnected') ? 'disconnected' : 'unknown';
      resolve({ gateway: true, whatsapp, raw: stdout });
    });
  });
});

// ============ IPC: OPENCLAW RESTART ============

ipcMain.handle('openclaw-restart', async () => {
  return new Promise((resolve) => {
    exec('openclaw daemon restart 2>&1', { encoding: 'utf8', timeout: 15000, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve({ success: false, error: err.message });
        return;
      }
      resolve({ success: true });
    });
  });
});

// ============ IPC: AUTO-START SETTINGS ============

ipcMain.handle('get-autostart', async () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('set-autostart', async (_, enabled: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
  });
  return { success: true, enabled };
});

// ============ IPC: MINIMIZE TO TRAY ============

ipcMain.handle('minimize-to-tray', async () => {
  mainWindow?.hide();
  return { success: true };
});
