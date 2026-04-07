// ACP Connection — manages a persistent Claude Code process via JSON-RPC 2.0

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';

// ACP package (same as AionUI uses)
const CLAUDE_ACP_PACKAGE = '@agentclientprotocol/claude-agent-acp@latest';

interface AcpMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

type MessageHandler = (message: AcpMessage) => void;

export class AcpConnection {
  private child: ChildProcess | null = null;
  private buffer = '';
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function; timeoutId?: NodeJS.Timeout }>();
  private sessionId: string | null = null;
  private onUpdate: MessageHandler | null = null;
  private onError: ((err: string) => void) | null = null;

  // Connect to Claude ACP bridge
  async connect(workingDir: string): Promise<void> {
    // Find npx
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

    const args = ['--yes', '--prefer-offline', CLAUDE_ACP_PACKAGE];

    // Clean environment — remove Electron vars AND OpenClaw's npm vars that cause conflicts
    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.NODE_OPTIONS;
    delete cleanEnv.NODE_PATH;
    // Remove ALL npm/npx lifecycle vars and paths
    Object.keys(cleanEnv).forEach(k => {
      if (k.startsWith('npm_') || k.startsWith('NPM_')) delete cleanEnv[k];
    });
    // Remove CLAUDECODE env var (prevents nested session detection)
    delete cleanEnv.CLAUDECODE;

    const isWindows = process.platform === 'win32';

    // On Windows, find the SYSTEM npx (not OpenClaw's bundled one)
    let npxPath = npxCmd;
    if (isWindows) {
      const fs = require('fs');
      // Check standard Node.js install locations
      const systemPaths = [
        'C:\\Program Files\\nodejs\\npx.cmd',
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'npx.cmd'),
      ];
      for (const p of systemPaths) {
        if (fs.existsSync(p)) {
          npxPath = p;
          break;
        }
      }
    }

    const cmd = isWindows ? `chcp 65001 >nul && "${npxPath}"` : npxCmd;

    this.child = spawn(cmd, args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv,
      shell: isWindows,
      detached: !isWindows,
    });

    if (!isWindows && this.child.pid) {
      this.child.unref();
    }

    // Set up stdout line buffering + JSON parsing
    this.child.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line) as AcpMessage;
            this.handleMessage(msg);
          } catch {
            // Ignore non-JSON lines (startup banners, etc.)
          }
        }
      }
    });

    this.child.stderr?.on('data', (data: Buffer) => {
      // stderr is diagnostic, not protocol
      const text = data.toString();
      if (this.onError) this.onError(text);
    });

    this.child.on('error', (err) => {
      if (this.onError) this.onError(err.message);
    });

    this.child.on('exit', (code) => {
      this.child = null;
      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        pending.reject(new Error(`Process exited with code ${code}`));
      }
      this.pendingRequests.clear();
    });

    // Initialize protocol (matches AionUI format)
    await this.sendRequest('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    });
  }

  // Send JSON-RPC request and wait for response
  sendRequest(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;

      // Timeout after 5 minutes
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 300000);

      this.pendingRequests.set(id, { resolve, reject, timeoutId });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.child?.stdin?.write(msg + '\n');
    });
  }

  // Send notification (no response expected)
  sendNotification(method: string, params: any = {}): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.child?.stdin?.write(msg + '\n');
  }

  // Handle incoming messages
  private handleMessage(msg: AcpMessage): void {
    // Response to our request
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      if (msg.error) pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else pending.resolve(msg.result || msg);
      return;
    }

    // Incoming request from Claude (permission request, etc.)
    if (msg.method === 'permission/request') {
      // Auto-approve all permissions (bypass mode)
      const response = JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: { approved: true },
      });
      this.child?.stdin?.write(response + '\n');
      return;
    }

    // Stream update (text chunks, tool calls, etc.)
    if (msg.method) {
      if (this.onUpdate) this.onUpdate(msg);
    }
  }

  // Create new session — try resume first, fallback to fresh session
  async newSession(workingDir: string, resumeSessionId?: string): Promise<string> {
    // Try resume if we have a session ID
    if (resumeSessionId) {
      try {
        const params: any = {
          cwd: workingDir,
          mcpServers: [],
          _meta: {
            claudeCode: {
              options: { resume: resumeSessionId },
            },
          },
        };
        const response = await this.sendRequest('session/new', params);
        if (response.sessionId) {
          this.sessionId = response.sessionId;
          return this.sessionId!;
        }
      } catch {
        // Resume failed — create fresh session below
      }
    }

    // Fresh session (no resume)
    const response = await this.sendRequest('session/new', {
      cwd: workingDir,
      mcpServers: [],
    });
    this.sessionId = response.sessionId;
    return this.sessionId!;
  }

  // Send a prompt (user message) — matches AionUI/ACP format
  async prompt(message: string): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session. Call newSession() first.');
    }
    await this.sendRequest('session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text: message }],
    });
  }

  // Cancel ongoing generation
  async cancel(): Promise<void> {
    try {
      await this.sendRequest('session/cancel', {});
    } catch {
      // Ignore cancel errors
    }
  }

  // Set update handler (for streaming responses)
  setUpdateHandler(handler: MessageHandler): void {
    this.onUpdate = handler;
  }

  // Set error handler
  setErrorHandler(handler: (err: string) => void): void {
    this.onError = handler;
  }

  // Get session ID
  getSessionId(): string | null {
    return this.sessionId;
  }

  // Check if connected
  isConnected(): boolean {
    return this.child !== null && !this.child.killed;
  }

  // Disconnect
  disconnect(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    for (const [, pending] of this.pendingRequests) {
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
    }
    this.pendingRequests.clear();
    this.sessionId = null;
  }
}
