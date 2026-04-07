import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export interface StreamEvent {
  type: 'text' | 'thought' | 'tool' | 'tool_update' | 'error' | 'done';
  content?: string;
  name?: string;
  title?: string;
  input?: string;
  toolCallId?: string;
  status?: string;
}

export interface ConversationEntry {
  id: string;
  sessionId: string;
  title: string;
  timestamp: number;
  messages: any[];
}

declare global {
  interface Window {
    electronAPI: {
      checkTool: (tool: string) => Promise<{ installed: boolean; version: string | null }>;
      installTool: (tool: string) => Promise<{ success: boolean; output?: string; error?: string }>;
      claudeChat: (message: string, workDir: string, imageBase64?: string | string[]) => Promise<{ success: boolean; output: string; sessionId?: string }>;
      claudeCancel: () => Promise<any>;
      onClaudeStream: (callback: (data: any) => void) => void;
      onClaudeStreamEnd: (callback: (data: any) => void) => void;
      removeStreamListeners: () => void;
      getOpenclawStatus: () => Promise<any>;
      restartOpenclaw: () => Promise<any>;
      getConversations: () => Promise<ConversationEntry[]>;
      saveConversation: (conv: ConversationEntry) => Promise<any>;
      deleteConversation: (id: string) => Promise<any>;
      claudeNewSession: (workDir: string, resumeSessionId?: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
      getLogs: (date?: string) => Promise<{ content: string; files: { date: string; size: number }[]; logDir: string }>;
      getLogDir: () => Promise<string>;
      authLoginGoogle: () => Promise<{ success: boolean; user?: any; error?: string }>;
      authGetUser: () => Promise<any>;
      authLogout: () => Promise<{ success: boolean }>;
    };
  }
}

@Injectable({ providedIn: 'root' })
export class ClaudeService {
  isStreaming = false;
  private workDir = '';

  constructor(private ngZone: NgZone) {
    const stored = localStorage.getItem('xbb-workspace');
    // Migrate away from .openclaw default
    if (stored && stored.includes('.openclaw')) {
      localStorage.removeItem('xbb-workspace');
      this.workDir = '';
    } else {
      this.workDir = stored || '';
    }
  }

  setWorkDir(dir: string) {
    this.workDir = dir;
    localStorage.setItem('xbb-workspace', dir);
  }

  getWorkDir(): string {
    return this.workDir;
  }

  sendMessage(message: string, imageBase64?: string | string[]): Observable<StreamEvent> {
    const subject = new Subject<StreamEvent>();
    this.isStreaming = true;

    window.electronAPI.removeStreamListeners();

    window.electronAPI.onClaudeStream((data: any) => {
      this.ngZone.run(() => {
        if (data.type === 'text' && data.content) {
          subject.next({ type: 'text', content: data.content });
        } else if (data.type === 'thought' && data.content) {
          subject.next({ type: 'thought', content: data.content });
        } else if (data.type === 'tool') {
          subject.next({
            type: 'tool',
            toolCallId: data.toolCallId,
            name: data.title || data.name || 'Tool',
            title: data.title || data.name || 'Tool',
            input: data.input || '',
            status: data.status || 'running',
          });
        } else if (data.type === 'tool_update') {
          subject.next({
            type: 'tool_update',
            toolCallId: data.toolCallId,
            status: data.status,
            content: data.content || '',
          });
        } else if (data.type === 'error' && data.content) {
          subject.next({ type: 'error', content: data.content });
        } else if (data.type === 'done') {
          // handled by stream-end
        }
        // Legacy format
        else if (data.type === 'assistant' && data.content) {
          if (typeof data.content === 'string') {
            subject.next({ type: 'text', content: data.content });
          } else if (Array.isArray(data.content)) {
            for (const block of data.content) {
              if (block.type === 'text') {
                subject.next({ type: 'text', content: block.text });
              }
            }
          }
        }
      });
    });

    window.electronAPI.onClaudeStreamEnd(() => {
      this.ngZone.run(() => {
        this.isStreaming = false;
        subject.complete();
        window.electronAPI.removeStreamListeners();
      });
    });

    window.electronAPI.claudeChat(message, this.workDir || '', imageBase64).catch((err) => {
      this.ngZone.run(() => {
        this.isStreaming = false;
        subject.error(err);
        window.electronAPI.removeStreamListeners();
      });
    });

    return subject.asObservable();
  }
}
