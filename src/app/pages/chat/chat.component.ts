import { Component, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClaudeService } from '../../services/claude.service';
import { Subscription } from 'rxjs';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  changedFiles?: string[];
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="chat-page">
      <div class="chat-header">
        <h2>Chat with Claude</h2>
        <span class="streaming-badge" *ngIf="claude.isStreaming">Thinking...</span>
      </div>

      <div class="chat-messages" #messagesContainer>
        <div class="empty-state" *ngIf="messages.length === 0">
          <div class="empty-icon">&#128172;</div>
          <h3>Ask Claude anything about your OpenClaw setup</h3>
          <p>Examples:</p>
          <div class="example-prompts">
            <button class="example-btn" (click)="sendExample('Check if my WhatsApp gateway is running')">
              Check if my WhatsApp gateway is running
            </button>
            <button class="example-btn" (click)="sendExample('Show me the current agent configuration')">
              Show me the current agent configuration
            </button>
            <button class="example-btn" (click)="sendExample('Restart the OpenClaw daemon')">
              Restart the OpenClaw daemon
            </button>
          </div>
        </div>

        <div
          *ngFor="let msg of messages; let i = index"
          class="message-row"
          [class.user]="msg.role === 'user'"
          [class.assistant]="msg.role === 'assistant'">
          <div class="bubble" [class.user-bubble]="msg.role === 'user'" [class.assistant-bubble]="msg.role === 'assistant'">
            <div class="bubble-content" [innerHTML]="formatContent(msg.content)"></div>
            <div class="bubble-time">{{ msg.timestamp | date:'HH:mm' }}</div>
          </div>
          <div class="changed-files" *ngIf="msg.changedFiles && msg.changedFiles.length > 0">
            <div class="files-header">
              <span>Changed files:</span>
              <button class="undo-btn" (click)="undo(i)">Undo</button>
            </div>
            <ul>
              <li *ngFor="let f of msg.changedFiles">{{ f }}</li>
            </ul>
          </div>
        </div>

        <div class="thinking-indicator" *ngIf="claude.isStreaming && !currentStream">
          <div class="dot"></div>
          <div class="dot"></div>
          <div class="dot"></div>
        </div>
      </div>

      <div class="chat-input-area">
        <div class="input-wrapper">
          <textarea
            [(ngModel)]="inputText"
            (keydown.enter)="onEnterKey($event)"
            placeholder="Type your message..."
            rows="1"
            [disabled]="claude.isStreaming"
            #inputField></textarea>
          <button
            class="send-btn"
            (click)="send()"
            [disabled]="!inputText.trim() || claude.isStreaming">
            <span>&#10148;</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .chat-page {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .chat-header {
      padding: 16px 24px;
      background: #fff;
      border-bottom: 1px solid #e0e0e0;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    .chat-header h2 {
      margin: 0;
      font-size: 18px;
      color: #1a1a2e;
    }
    .streaming-badge {
      font-size: 12px;
      background: #00a884;
      color: #fff;
      padding: 3px 10px;
      border-radius: 12px;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      text-align: center;
      color: #888;
    }
    .empty-icon {
      font-size: 48px;
      margin-bottom: 12px;
    }
    .empty-state h3 {
      font-size: 18px;
      margin: 0 0 8px;
      color: #555;
    }
    .empty-state p {
      margin: 0 0 16px;
      font-size: 14px;
    }
    .example-prompts {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .example-btn {
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 13px;
      cursor: pointer;
      color: #333;
      transition: all 0.15s;
    }
    .example-btn:hover {
      border-color: #00a884;
      color: #00a884;
    }
    .message-row {
      display: flex;
      flex-direction: column;
      max-width: 75%;
    }
    .message-row.user {
      align-self: flex-end;
      align-items: flex-end;
    }
    .message-row.assistant {
      align-self: flex-start;
      align-items: flex-start;
    }
    .bubble {
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .user-bubble {
      background: #dcf8c6;
      color: #1a1a1a;
      border-bottom-right-radius: 4px;
    }
    .assistant-bubble {
      background: #fff;
      color: #1a1a1a;
      border: 1px solid #e8e8e8;
      border-bottom-left-radius: 4px;
    }
    .bubble-content {
      margin: 0;
    }
    .bubble-content :first-child {
      margin-top: 0;
    }
    .bubble-content :last-child {
      margin-bottom: 0;
    }
    .bubble-time {
      font-size: 11px;
      color: #999;
      margin-top: 4px;
      text-align: right;
    }
    .changed-files {
      margin-top: 6px;
      padding: 8px 12px;
      background: #fff8e1;
      border-radius: 8px;
      font-size: 12px;
      border: 1px solid #ffe082;
    }
    .files-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .undo-btn {
      background: none;
      border: 1px solid #ef6c00;
      color: #ef6c00;
      padding: 2px 10px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
    }
    .undo-btn:hover {
      background: #ef6c00;
      color: #fff;
    }
    .changed-files ul {
      margin: 0;
      padding-left: 18px;
    }
    .changed-files li {
      color: #555;
      font-family: monospace;
      font-size: 12px;
    }
    .thinking-indicator {
      display: flex;
      gap: 4px;
      padding: 8px;
      align-self: flex-start;
    }
    .thinking-indicator .dot {
      width: 8px;
      height: 8px;
      background: #bbb;
      border-radius: 50%;
      animation: bounce 1.2s infinite;
    }
    .thinking-indicator .dot:nth-child(2) { animation-delay: 0.2s; }
    .thinking-indicator .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }
    .chat-input-area {
      padding: 16px 24px;
      background: #fff;
      border-top: 1px solid #e0e0e0;
      flex-shrink: 0;
    }
    .input-wrapper {
      display: flex;
      gap: 10px;
      align-items: flex-end;
    }
    .input-wrapper textarea {
      flex: 1;
      border: 1px solid #ddd;
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 14px;
      font-family: inherit;
      resize: none;
      outline: none;
      max-height: 120px;
      line-height: 1.4;
    }
    .input-wrapper textarea:focus {
      border-color: #00a884;
    }
    .send-btn {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      border: none;
      background: #00a884;
      color: #fff;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: opacity 0.15s;
    }
    .send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .send-btn:hover:not(:disabled) {
      background: #009674;
    }
  `],
})
export class ChatComponent implements OnDestroy, AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;

  messages: ChatMessage[] = [];
  inputText = '';
  currentStream = '';
  private streamSub: Subscription | null = null;
  private shouldScroll = false;

  constructor(public claude: ClaudeService) {}

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  ngOnDestroy() {
    this.streamSub?.unsubscribe();
  }

  onEnterKey(event: Event) {
    const ke = event as KeyboardEvent;
    if (!ke.shiftKey) {
      ke.preventDefault();
      this.send();
    }
  }

  sendExample(text: string) {
    this.inputText = text;
    this.send();
  }

  send() {
    const text = this.inputText.trim();
    if (!text || this.claude.isStreaming) return;

    this.messages.push({
      role: 'user',
      content: text,
      timestamp: new Date(),
    });

    this.inputText = '';
    this.currentStream = '';
    this.shouldScroll = true;

    // Create the assistant message placeholder
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };
    this.messages.push(assistantMsg);

    this.streamSub = this.claude.sendMessage(text).subscribe({
      next: (chunk) => {
        this.currentStream += chunk;
        assistantMsg.content = this.currentStream;
        this.shouldScroll = true;
      },
      error: (err) => {
        assistantMsg.content = this.currentStream || `Error: ${err.message || 'Something went wrong'}`;
        this.currentStream = '';
      },
      complete: () => {
        if (!assistantMsg.content) {
          assistantMsg.content = this.currentStream || '(No response)';
        }
        // Try to extract changed files from content
        assistantMsg.changedFiles = this.extractChangedFiles(assistantMsg.content);
        this.currentStream = '';
      },
    });
  }

  undo(messageIndex: number) {
    const msg = this.messages[messageIndex];
    if (!msg?.changedFiles?.length) return;
    // Send an undo request to Claude
    this.inputText = `Undo the changes you just made to: ${msg.changedFiles.join(', ')}`;
    this.send();
  }

  formatContent(content: string): string {
    // Basic formatting: escape HTML, then convert markdown-style code blocks
    let html = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    return html;
  }

  private extractChangedFiles(content: string): string[] {
    const files: string[] = [];
    const patterns = [
      /(?:wrote|edited|created|modified|updated)\s+(?:file\s+)?[`"]?([/\w.\-]+)[`"]?/gi,
      /(?:Writing|Editing|Creating)\s+(?:to\s+)?[`"]?([/\w.\-]+)[`"]?/gi,
    ];
    for (const pat of patterns) {
      let match;
      while ((match = pat.exec(content)) !== null) {
        const file = match[1];
        if (file && !files.includes(file) && file.includes('.')) {
          files.push(file);
        }
      }
    }
    return files;
  }

  private scrollToBottom() {
    try {
      const el = this.messagesContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch {}
  }
}
