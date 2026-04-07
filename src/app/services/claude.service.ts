import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';

declare global {
  interface Window {
    electronAPI: {
      checkTool: (tool: string) => Promise<{ installed: boolean; version: string | null }>;
      installTool: (tool: string) => Promise<{ success: boolean; output?: string; error?: string }>;
      claudeChat: (message: string, workDir: string) => Promise<{ success: boolean; output: string }>;
      onClaudeStream: (callback: (data: any) => void) => void;
      onClaudeStreamEnd: (callback: (data: any) => void) => void;
      removeStreamListeners: () => void;
      getOpenclawStatus: () => Promise<any>;
      restartOpenclaw: () => Promise<any>;
    };
  }
}

@Injectable({ providedIn: 'root' })
export class ClaudeService {
  isStreaming = false;
  private workDir = '';

  constructor(private ngZone: NgZone) {
    const stored = localStorage.getItem('xbb-workspace');
    this.workDir = stored || '';
  }

  setWorkDir(dir: string) {
    this.workDir = dir;
    localStorage.setItem('xbb-workspace', dir);
  }

  getWorkDir(): string {
    return this.workDir;
  }

  sendMessage(message: string): Observable<string> {
    const subject = new Subject<string>();
    this.isStreaming = true;

    window.electronAPI.removeStreamListeners();

    window.electronAPI.onClaudeStream((data: any) => {
      this.ngZone.run(() => {
        // Handle our ACP StreamChunk format
        if (data.type === 'text' && data.content) {
          subject.next(data.content);
        } else if (data.type === 'thought' && data.content) {
          subject.next(`_${data.content}_`);
        } else if (data.type === 'tool') {
          const toolInfo = data.name ? `\n🔧 **${data.name}**` : '';
          const toolInput = data.input ? `\n\`${data.input}\`` : '';
          subject.next(`${toolInfo}${toolInput}\n`);
        } else if (data.type === 'tool_update' && data.content) {
          subject.next(data.content);
        } else if (data.type === 'error' && data.content) {
          subject.next(`[Error] ${data.content}`);
        } else if (data.type === 'done') {
          // Completion signal — handled by stream-end
        }
        // Legacy format support (in case old code path is hit)
        else if (data.type === 'assistant' && data.content) {
          if (typeof data.content === 'string') {
            subject.next(data.content);
          } else if (Array.isArray(data.content)) {
            for (const block of data.content) {
              if (block.type === 'text') {
                subject.next(block.text);
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

    window.electronAPI.claudeChat(message, this.workDir || '').catch((err) => {
      this.ngZone.run(() => {
        this.isStreaming = false;
        subject.error(err);
        window.electronAPI.removeStreamListeners();
      });
    });

    return subject.asObservable();
  }
}
