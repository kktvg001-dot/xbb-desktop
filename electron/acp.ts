// ACP Connection — battle-tested implementation adapted from AionUI
// Manages a persistent Claude Code process via JSON-RPC 2.0 over stdio

import { spawn, ChildProcess, execFileSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// ACP bridge package (pinned version from AionUI)
const CLAUDE_ACP_NPX_PACKAGE = '@zed-industries/claude-agent-acp@0.21.0';

const JSONRPC_VERSION = '2.0' as const;

// ── Types ──────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonRpcNotification {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
  method: string;
  isPaused: boolean;
  startTime: number;
  timeoutDuration: number;
  promptOriginTime: number;
}

// Stream update types for the renderer
export interface StreamChunk {
  type: 'text' | 'thought' | 'tool' | 'tool_update' | 'error' | 'done';
  content?: string;
  name?: string;
  input?: string;
  toolCallId?: string;
  status?: string;
  title?: string;
}

// ── AcpConnection ──────────────────────────────────────────────────

export class AcpConnection {
  private child: ChildProcess | null = null;
  private isDetached = false;
  private buffer = '';
  private nextRequestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private sessionId: string | null = null;
  private isInitialized = false;
  private isSetupComplete = false;
  private workingDir: string = process.cwd();

  // Timeout config (from AionUI)
  private promptTimeoutMs = 300_000; // 5 min for prompts
  private static readonly KEEPALIVE_INTERVAL_MS = 60_000; // 60s keepalive
  private promptKeepaliveInterval: NodeJS.Timeout | null = null;

  // Callbacks
  public onStreamChunk: (chunk: StreamChunk) => void = () => {};
  public onError: (err: string) => void = () => {};
  public onDisconnect: (info: { code: number | null; signal: string | null }) => void = () => {};

  // ── Connect ────────────────────────────────────────────────────

  async connect(workingDir: string, customEnv?: Record<string, string>): Promise<void> {
    if (this.child) {
      await this.disconnect();
    }

    this.workingDir = workingDir;

    // Ensure working directory exists
    try {
      fs.mkdirSync(workingDir, { recursive: true });
    } catch {}

    // Prepare clean environment (exact AionUI pattern)
    const cleanEnv: Record<string, string | undefined> = { ...process.env };

    // Remove Electron-injected vars that break child Node.js
    delete cleanEnv.NODE_OPTIONS;
    delete cleanEnv.NODE_INSPECT;
    delete cleanEnv.NODE_DEBUG;
    // Remove CLAUDECODE to prevent nested session detection
    delete cleanEnv.CLAUDECODE;
    // Strip npm lifecycle vars (npm_config_*, npm_lifecycle_*, npm_package_*)
    for (const key of Object.keys(cleanEnv)) {
      if (key.startsWith('npm_')) {
        delete cleanEnv[key];
      }
    }

    // Apply custom env (API keys, etc.)
    if (customEnv) {
      Object.assign(cleanEnv, customEnv);
    }

    // Resolve npx path
    const isWindows = process.platform === 'win32';
    let npxCommand = isWindows ? 'npx.cmd' : 'npx';

    // On Windows, try to find system npx
    if (isWindows) {
      const systemPaths = [
        'C:\\Program Files\\nodejs\\npx.cmd',
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'npx.cmd'),
      ];
      for (const p of systemPaths) {
        if (fs.existsSync(p)) {
          npxCommand = p;
          break;
        }
      }
    }

    // Spawn args (AionUI pattern: --yes, --prefer-offline, package)
    const spawnArgs = ['--yes', '--prefer-offline', CLAUDE_ACP_NPX_PACKAGE];

    // Build spawn command (AionUI: chcp 65001 on Windows for UTF-8)
    const effectiveCommand = isWindows ? `chcp 65001 >nul && "${npxCommand}"` : npxCommand;

    // Detach on non-Windows (AionUI pattern)
    const detached = !isWindows;

    this.child = spawn(effectiveCommand, spawnArgs, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv,
      shell: isWindows,
      detached,
    });
    this.isDetached = detached;

    // Prevent detached child from keeping parent alive (AionUI pattern)
    if (detached) {
      this.child.unref();
    }

    // Set up handlers
    await this.setupChildProcessHandlers();

    // Mark setup complete
    this.isSetupComplete = true;
  }

  // ── Child Process Setup (AionUI pattern) ───────────────────────

  private async setupChildProcessHandlers(): Promise<void> {
    const child = this.child;
    if (!child) throw new Error('Child process not initialized');

    let spawnError: Error | null = null;

    // Collect stderr for diagnostics (AionUI: head + tail)
    let stderrCollected = '';
    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      console.error('[ACP STDERR]:', chunk);
      stderrCollected += chunk;
      if (stderrCollected.length > 2048) {
        stderrCollected = stderrCollected.slice(-2048);
      }
    });

    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        spawnError = new Error('Claude ACP bridge not found. Is Node.js installed?');
      } else {
        spawnError = error;
      }
    });

    // Promise for early exit detection (AionUI pattern)
    let processExitReject: ((err: Error) => void) | null = null;
    const processExitPromise = new Promise<never>((_resolve, reject) => {
      processExitReject = reject;
    });

    child.on('exit', (code, signal) => {
      console.error(`[ACP] Process exited with code: ${code}, signal: ${signal}`);

      if (!this.isSetupComplete) {
        // Startup phase
        const errMsg = stderrCollected
          ? `ACP process exited during startup (code: ${code}):\n${stderrCollected}`
          : `ACP process exited during startup (code: ${code}, signal: ${signal})`;
        if (!spawnError) {
          spawnError = new Error(errMsg);
        }
        processExitReject?.(new Error(errMsg));
      } else {
        // Runtime phase - handle unexpected exit
        this.handleProcessExit(code, signal);
      }
    });

    // Line-buffered stdout parsing (exact AionUI pattern)
    child.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line) as JsonRpcMessage;
            this.handleMessage(message);
          } catch {
            // Ignore non-JSON lines (startup banners, etc.)
          }
        }
      }
    });

    // Yield to event loop so spawn error/exit events can fire (AionUI pattern)
    await new Promise((resolve) => setImmediate(resolve));

    if (spawnError) throw spawnError;
    if (child.killed) throw new Error('ACP process failed to start');

    // Initialize protocol with timeout, racing against early exit (AionUI pattern)
    try {
      await Promise.race([
        this.initialize(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Initialize timeout after 60 seconds')), 60000)
        ),
        processExitPromise,
      ]);
    } finally {
      processExitReject = null;
      processExitPromise.catch(() => {});
    }
  }

  // ── Protocol Methods ───────────────────────────────────────────

  private async initialize(): Promise<unknown> {
    const response = await this.sendRequest('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    });
    this.isInitialized = true;
    return response;
  }

  async newSession(workingDir: string, resumeSessionId?: string): Promise<string> {
    // Try resume if we have a session ID (AionUI _meta pattern)
    if (resumeSessionId) {
      try {
        const response = await this.sendRequest('session/new', {
          cwd: workingDir,
          mcpServers: [],
          _meta: {
            claudeCode: {
              options: { resume: resumeSessionId },
            },
          },
        }) as any;
        if (response?.sessionId) {
          this.sessionId = response.sessionId;
          return this.sessionId!;
        }
      } catch {
        // Resume failed — create fresh session below
        console.warn('[ACP] Session resume failed, creating fresh session');
      }
    }

    // Fresh session
    const response = await this.sendRequest('session/new', {
      cwd: workingDir,
      mcpServers: [],
    }) as any;
    this.sessionId = response.sessionId;
    return this.sessionId!;
  }

  async sendPrompt(message: string): Promise<unknown> {
    if (!this.sessionId) {
      throw new Error('No active session. Call newSession() first.');
    }

    this.startPromptKeepalive();
    try {
      return await this.sendRequest('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: message }],
      });
    } finally {
      this.stopPromptKeepalive();
    }
  }

  cancelPrompt(): void {
    if (!this.sessionId) return;

    // Send cancel notification (no response expected)
    this.writeMessage({
      jsonrpc: JSONRPC_VERSION,
      method: 'session/cancel',
      params: { sessionId: this.sessionId },
    });

    // Clear all pending session/prompt requests
    for (const [id, request] of this.pendingRequests) {
      if (request.method === 'session/prompt') {
        if (request.timeoutId) clearTimeout(request.timeoutId);
        this.pendingRequests.delete(id);
        request.resolve(null);
      }
    }
  }

  // ── JSON-RPC Transport ─────────────────────────────────────────

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextRequestId++;
    const message: JsonRpcRequest = {
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      ...(params && { params }),
    };

    return new Promise((resolve, reject) => {
      // Longer timeout for prompts (AionUI pattern)
      const timeoutDuration = method === 'session/prompt' ? this.promptTimeoutMs : 60000;
      const startTime = Date.now();

      const timeoutId = setTimeout(() => {
        const request = this.pendingRequests.get(id);
        if (request && !request.isPaused) {
          this.pendingRequests.delete(id);
          if (method === 'session/prompt') {
            this.cancelPrompt();
          }
          reject(new Error(
            method === 'session/prompt'
              ? `LLM request timed out after ${timeoutDuration / 1000} seconds`
              : `Request ${method} timed out after ${timeoutDuration / 1000} seconds`
          ));
        }
      }, timeoutDuration);

      const pending: PendingRequest = {
        resolve: (value) => {
          if (pending.timeoutId) clearTimeout(pending.timeoutId);
          resolve(value);
        },
        reject: (error) => {
          if (pending.timeoutId) clearTimeout(pending.timeoutId);
          reject(error);
        },
        timeoutId,
        method,
        isPaused: false,
        startTime,
        timeoutDuration,
        promptOriginTime: startTime,
      };

      this.pendingRequests.set(id, pending);
      this.writeMessage(message);
    });
  }

  private writeMessage(message: object): void {
    if (this.child?.stdin) {
      const lineEnding = process.platform === 'win32' ? '\r\n' : '\n';
      this.child.stdin.write(JSON.stringify(message) + lineEnding);
    }
  }

  // ── Message Handling (AionUI pattern) ──────────────────────────

  private handleMessage(message: JsonRpcMessage): void {
    try {
      // Check if it's a request/notification (has method field)
      if ('method' in message && message.method) {
        this.handleIncomingRequest(message as any);
        return;
      }

      // Check if it's a response to our request
      if ('id' in message && typeof message.id === 'number' && this.pendingRequests.has(message.id)) {
        const pending = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);

        if ('error' in message && message.error) {
          pending.reject(new Error(message.error.message || 'Unknown ACP error'));
        } else {
          pending.resolve((message as JsonRpcResponse).result);
        }
      }
    } catch {}
  }

  private handleIncomingRequest(message: { jsonrpc: string; id?: number; method: string; params?: any }): void {
    try {
      let result: any = null;

      switch (message.method) {
        case 'session/update':
          // Reset timeout on streaming updates (AionUI pattern)
          this.resetSessionPromptTimeouts();
          // Extract and forward content to renderer
          this.processSessionUpdate(message.params);
          break;

        case 'session/request_permission':
          // Auto-approve all permissions (bypass mode, AionUI pattern)
          result = {
            outcome: {
              outcome: 'selected',
              optionId: 'allow_always',
            },
          };
          break;

        case 'fs/read_text_file':
          // Handle file read requests from the agent
          try {
            const readPath = this.resolveWorkspacePath(message.params?.path);
            const content = fs.readFileSync(readPath, 'utf-8');
            result = { content };
          } catch (err: any) {
            // Send error response
            if (typeof message.id === 'number') {
              this.writeMessage({
                jsonrpc: JSONRPC_VERSION,
                id: message.id,
                error: { code: -32603, message: err.message },
              });
              return;
            }
          }
          break;

        case 'fs/write_text_file':
          // Handle file write requests from the agent
          try {
            const writePath = this.resolveWorkspacePath(message.params?.path);
            fs.mkdirSync(path.dirname(writePath), { recursive: true });
            fs.writeFileSync(writePath, message.params?.content || '', 'utf-8');
            result = null;
          } catch (err: any) {
            if (typeof message.id === 'number') {
              this.writeMessage({
                jsonrpc: JSONRPC_VERSION,
                id: message.id,
                error: { code: -32603, message: err.message },
              });
              return;
            }
          }
          break;
      }

      // Send response if this was a request (has id)
      if (typeof message.id === 'number') {
        this.writeMessage({
          jsonrpc: JSONRPC_VERSION,
          id: message.id,
          result,
        });
      }
    } catch (err: any) {
      if (typeof message.id === 'number') {
        this.writeMessage({
          jsonrpc: JSONRPC_VERSION,
          id: message.id,
          error: { code: -32603, message: err.message || String(err) },
        });
      }
    }
  }

  // ── Text Extraction from Session Updates (AionUI types) ────────

  private processSessionUpdate(params: any): void {
    if (!params?.update) return;

    const update = params.update;
    const sessionUpdate = update.sessionUpdate;

    switch (sessionUpdate) {
      case 'agent_message_chunk':
        // Text content from the agent
        if (update.content?.text) {
          this.onStreamChunk({
            type: 'text',
            content: update.content.text,
          });
        }
        break;

      case 'agent_thought_chunk':
        // Thinking/reasoning content
        if (update.content?.text) {
          this.onStreamChunk({
            type: 'thought',
            content: update.content.text,
          });
        }
        break;

      case 'tool_call':
        // Tool invocation (Read, Edit, Bash, etc.)
        this.onStreamChunk({
          type: 'tool',
          toolCallId: update.toolCallId,
          name: update.title || 'tool',
          status: update.status,
          title: update.title,
          input: this.extractToolInput(update),
        });
        break;

      case 'tool_call_update':
        // Tool result/completion
        this.onStreamChunk({
          type: 'tool_update',
          toolCallId: update.toolCallId,
          status: update.status,
          content: this.extractToolContent(update),
        });
        break;

      // plan, available_commands_update, user_message_chunk, config_option_update, usage_update
      // are not displayed in our simple chat UI
    }
  }

  private extractToolInput(update: any): string {
    if (update.rawInput) {
      // For Bash tools, show the command
      if (update.rawInput.command) return update.rawInput.command;
      // For file tools, show the path
      if (update.rawInput.file_path) return update.rawInput.file_path;
      if (update.rawInput.path) return update.rawInput.path;
      // For search, show the pattern
      if (update.rawInput.pattern) return update.rawInput.pattern;
      // Fallback: show first string value
      const vals = Object.values(update.rawInput).filter((v): v is string => typeof v === 'string');
      if (vals.length > 0) return vals[0];
    }
    // Content items
    if (update.content?.length > 0) {
      const textItem = update.content.find((c: any) => c.content?.text);
      if (textItem) return textItem.content.text;
    }
    return '';
  }

  private extractToolContent(update: any): string {
    if (update.content?.length > 0) {
      return update.content
        .filter((c: any) => c.content?.text)
        .map((c: any) => c.content.text)
        .join('\n');
    }
    return '';
  }

  private resolveWorkspacePath(targetPath: string): string {
    if (!targetPath) return this.workingDir;
    if (path.isAbsolute(targetPath)) return targetPath;
    return path.join(this.workingDir, targetPath);
  }

  // ── Keepalive (AionUI pattern) ─────────────────────────────────

  private startPromptKeepalive(): void {
    this.stopPromptKeepalive();
    this.promptKeepaliveInterval = setInterval(() => {
      if (!this.isChildAlive()) return;
      // Only reset for requests within their original budget
      const now = Date.now();
      const hasEligible = [...this.pendingRequests.values()].some(
        (r) => r.method === 'session/prompt' && now - r.promptOriginTime < r.timeoutDuration
      );
      if (hasEligible) {
        this.resetSessionPromptTimeouts();
      }
    }, AcpConnection.KEEPALIVE_INTERVAL_MS);
  }

  private stopPromptKeepalive(): void {
    if (this.promptKeepaliveInterval) {
      clearInterval(this.promptKeepaliveInterval);
      this.promptKeepaliveInterval = null;
    }
  }

  private isChildAlive(): boolean {
    return this.child !== null && !this.child.killed && this.child.exitCode === null && this.child.signalCode === null;
  }

  private resetSessionPromptTimeouts(): void {
    for (const [id, request] of this.pendingRequests) {
      if (request.method === 'session/prompt' && !request.isPaused && request.timeoutId) {
        clearTimeout(request.timeoutId);
        request.startTime = Date.now();
        request.timeoutId = setTimeout(() => {
          if (this.pendingRequests.has(id) && !request.isPaused) {
            this.pendingRequests.delete(id);
            this.cancelPrompt();
            request.reject(new Error(`LLM request timed out after ${request.timeoutDuration / 1000} seconds`));
          }
        }, request.timeoutDuration);
      }
    }
  }

  // ── Process Exit Handling ──────────────────────────────────────

  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.stopPromptKeepalive();

    // Reject all pending requests
    for (const [, request] of this.pendingRequests) {
      if (request.timeoutId) clearTimeout(request.timeoutId);
      request.reject(new Error(`ACP process exited unexpectedly (code: ${code}, signal: ${signal})`));
    }
    this.pendingRequests.clear();

    this.sessionId = null;
    this.isInitialized = false;
    this.isSetupComplete = false;
    this.isDetached = false;
    this.child = null;

    this.onDisconnect({ code, signal: signal as string | null });
  }

  // ── Public API ─────────────────────────────────────────────────

  getSessionId(): string | null {
    return this.sessionId;
  }

  isConnected(): boolean {
    return this.child !== null && !this.child.killed;
  }

  async disconnect(): Promise<void> {
    this.stopPromptKeepalive();

    if (this.child) {
      const pid = this.child.pid;

      if (process.platform === 'win32' && pid) {
        // Windows: taskkill tree kill (AionUI pattern)
        try {
          execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 5000, windowsHide: true } as any);
        } catch {}
      } else if (this.isDetached && pid) {
        // POSIX detached: process group kill (AionUI pattern)
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          this.child.kill('SIGTERM');
        }
      } else {
        this.child.kill('SIGTERM');
      }

      this.child = null;
    }

    this.isDetached = false;
    this.pendingRequests.clear();
    this.sessionId = null;
    this.isInitialized = false;
    this.isSetupComplete = false;
  }
}
