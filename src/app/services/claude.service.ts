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
        if (data.type === 'error') {
          subject.next(`[Error] ${data.content}`);
        } else if (data.type === 'assistant' && data.content) {
          if (typeof data.content === 'string') {
            subject.next(data.content);
          } else if (Array.isArray(data.content)) {
            for (const block of data.content) {
              if (block.type === 'text') {
                subject.next(block.text);
              }
            }
          }
        } else if (data.type === 'content_block_delta' && data.delta?.text) {
          subject.next(data.delta.text);
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
