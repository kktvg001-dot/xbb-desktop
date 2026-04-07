import { Component, OnDestroy, ViewChild, ElementRef, AfterViewChecked, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClaudeService, StreamEvent } from '../../services/claude.service';
import { Subscription } from 'rxjs';

interface ToolBlock {
  id: string;
  name: string;
  input: string;
  status: string;
  output: string;
  expanded: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  tools: ToolBlock[];
  error?: string;
  thinking?: string;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="chat-container"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)">
      <div class="chat-messages" #messagesContainer>

        <!-- Empty state -->
        <div class="empty-state" *ngIf="messages.length === 0 && !claude.isStreaming">
          <div class="empty-logo">C</div>
          <h2>What can I help you with?</h2>
          <div class="suggestions">
            <button class="suggestion" (click)="sendExample('Check if my WhatsApp gateway is running')">
              Check WhatsApp gateway status
            </button>
            <button class="suggestion" (click)="sendExample('Show me the current agent configuration')">
              Show agent configuration
            </button>
            <button class="suggestion" (click)="sendExample('List running services')">
              List running services
            </button>
          </div>
        </div>

        <!-- Messages -->
        <div class="messages-inner">
          <ng-container *ngFor="let msg of messages; let i = index">
            <!-- User message -->
            <div class="msg-row msg-user" *ngIf="msg.role === 'user'">
              <div class="user-bubble">{{ msg.content }}</div>
            </div>

            <!-- Assistant message -->
            <div class="msg-row msg-assistant" *ngIf="msg.role === 'assistant'">
              <!-- Thinking block -->
              <div class="thinking-block" *ngIf="msg.thinking">
                <span class="thinking-label">Thinking</span>
                <span class="thinking-text">{{ truncate(msg.thinking, 120) }}</span>
              </div>

              <!-- Tool cards -->
              <div class="tool-card" *ngFor="let tool of msg.tools" [class.tool-done]="tool.status === 'completed' || tool.status === 'done'" [class.tool-running]="tool.status === 'running' || tool.status === 'in_progress'">
                <div class="tool-header" (click)="tool.expanded = !tool.expanded">
                  <span class="tool-icon">
                    <svg *ngIf="tool.status === 'running' || tool.status === 'in_progress'" class="spinner" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="20 12" /></svg>
                    <span *ngIf="tool.status !== 'running' && tool.status !== 'in_progress'">&#10003;</span>
                  </span>
                  <span class="tool-name">{{ tool.name }}</span>
                  <span class="tool-input-preview" *ngIf="tool.input && !tool.expanded">{{ truncate(tool.input, 60) }}</span>
                  <span class="tool-expand">{{ tool.expanded ? '&#9650;' : '&#9660;' }}</span>
                </div>
                <div class="tool-body" *ngIf="tool.expanded">
                  <div class="tool-input-full" *ngIf="tool.input">
                    <pre>{{ tool.input }}</pre>
                  </div>
                  <div class="tool-output" *ngIf="tool.output">
                    <pre>{{ truncate(tool.output, 2000) }}</pre>
                  </div>
                </div>
              </div>

              <!-- Text content -->
              <div class="assistant-text" *ngIf="msg.content" [innerHTML]="formatMarkdown(msg.content)"></div>

              <!-- Error -->
              <div class="error-text" *ngIf="msg.error">{{ msg.error }}</div>
            </div>
          </ng-container>

          <!-- Streaming thinking dots -->
          <div class="msg-row msg-assistant" *ngIf="claude.isStreaming && isWaiting">
            <div class="thinking-dots">
              <span class="dot"></span>
              <span class="dot"></span>
              <span class="dot"></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Drag-drop overlay -->
      <div class="drop-overlay" *ngIf="isDragging"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)">
        <div class="drop-overlay-content">Drop image here</div>
      </div>

      <!-- Input bar -->
      <div class="input-bar">
        <!-- Image preview -->
        <div class="image-preview-wrapper" *ngIf="pendingImageBase64">
          <div class="image-preview">
            <img [src]="'data:image/png;base64,' + pendingImageBase64" alt="Pending image" />
            <button class="image-remove" (click)="removeImage()">&times;</button>
          </div>
        </div>
        <div class="input-area" [class.focused]="inputFocused">
          <textarea
            #inputField
            [(ngModel)]="inputText"
            (keydown)="onKeyDown($event)"
            (paste)="onPaste($event)"
            (focus)="inputFocused = true"
            (blur)="inputFocused = false"
            (input)="autoResize($event)"
            placeholder="Message Claude..."
            rows="1"
            [disabled]="claude.isStreaming"></textarea>
          <button
            class="send-button"
            (click)="send()"
            [class.visible]="inputText.trim().length > 0 || !!pendingImageBase64"
            [disabled]="(!inputText.trim() && !pendingImageBase64) || claude.isStreaming">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 14V2M8 2L3 7M8 2L13 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .chat-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: #f9f9f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    }

    /* ── Messages area ── */
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 24px 16px 8px;
    }

    .messages-inner {
      max-width: 800px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* ── Empty state ── */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 70vh;
      text-align: center;
    }
    .empty-logo {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #1a1a2e;
      color: #fff;
      font-size: 24px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
    }
    .empty-state h2 {
      font-size: 22px;
      font-weight: 600;
      color: #1a1a1a;
      margin: 0 0 24px;
    }
    .suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
    }
    .suggestion {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 20px;
      padding: 8px 16px;
      font-size: 13px;
      color: #444;
      cursor: pointer;
      transition: all 0.15s;
    }
    .suggestion:hover {
      border-color: #999;
      color: #111;
    }

    /* ── Message rows ── */
    .msg-row {
      display: flex;
      flex-direction: column;
    }

    /* ── User messages ── */
    .msg-user {
      align-items: flex-end;
    }
    .user-bubble {
      background: #059669;
      color: #fff;
      padding: 8px 14px;
      border-radius: 18px 18px 4px 18px;
      font-size: 14px;
      line-height: 1.5;
      max-width: 75%;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* ── Assistant messages ── */
    .msg-assistant {
      align-items: flex-start;
      gap: 8px;
    }

    .assistant-text {
      font-size: 14px;
      line-height: 1.7;
      color: #1a1a1a;
      max-width: 100%;
      word-break: break-word;
    }

    /* Markdown rendered content */
    .assistant-text :first-child { margin-top: 0; }
    .assistant-text :last-child { margin-bottom: 0; }

    /* ── Thinking ── */
    .thinking-block {
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-size: 12px;
      color: #888;
      padding: 4px 0;
    }
    .thinking-label {
      font-weight: 600;
      color: #aaa;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }
    .thinking-text {
      font-style: italic;
      color: #999;
    }

    /* ── Tool cards ── */
    .tool-card {
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      overflow: hidden;
      font-size: 13px;
      max-width: 100%;
    }
    .tool-card.tool-running {
      border-color: #d4a574;
    }
    .tool-card.tool-done {
      border-color: #e5e5e5;
    }
    .tool-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      user-select: none;
      background: #fafafa;
    }
    .tool-header:hover {
      background: #f0f0f0;
    }
    .tool-icon {
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #059669;
      font-size: 12px;
      flex-shrink: 0;
    }
    .tool-card.tool-running .tool-icon {
      color: #d97706;
    }
    .spinner {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .tool-name {
      font-weight: 600;
      color: #333;
      flex-shrink: 0;
    }
    .tool-input-preview {
      color: #888;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .tool-expand {
      color: #aaa;
      font-size: 10px;
      flex-shrink: 0;
    }
    .tool-body {
      border-top: 1px solid #eee;
      max-height: 300px;
      overflow-y: auto;
    }
    .tool-input-full,
    .tool-output {
      padding: 8px 12px;
    }
    .tool-input-full {
      background: #f8f8f8;
    }
    .tool-output {
      background: #fafafa;
      border-top: 1px solid #f0f0f0;
    }
    .tool-body pre {
      margin: 0;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
      color: #444;
    }

    /* ── Error text ── */
    .error-text {
      color: #dc2626;
      font-size: 13px;
      padding: 6px 10px;
      background: #fef2f2;
      border-radius: 6px;
      border: 1px solid #fee2e2;
    }

    /* ── Thinking dots ── */
    .thinking-dots {
      display: flex;
      gap: 4px;
      padding: 6px 0;
    }
    .thinking-dots .dot {
      width: 7px;
      height: 7px;
      background: #aaa;
      border-radius: 50%;
      animation: dotBounce 1.2s infinite;
    }
    .thinking-dots .dot:nth-child(2) { animation-delay: 0.15s; }
    .thinking-dots .dot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes dotBounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
      40% { transform: scale(1); opacity: 1; }
    }

    /* ── Drag-drop overlay ── */
    .drop-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(5, 150, 105, 0.08);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .drop-overlay-content {
      padding: 40px 60px;
      border: 3px dashed #059669;
      border-radius: 16px;
      font-size: 18px;
      font-weight: 600;
      color: #059669;
      background: rgba(255, 255, 255, 0.9);
    }

    /* ── Image preview ── */
    .image-preview-wrapper {
      max-width: 800px;
      margin: 0 auto 8px;
    }
    .image-preview {
      position: relative;
      display: inline-block;
    }
    .image-preview img {
      max-height: 200px;
      max-width: 100%;
      border-radius: 10px;
      border: 1px solid #e0e0e0;
      object-fit: contain;
    }
    .image-remove {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: none;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: background 0.15s;
    }
    .image-remove:hover {
      background: rgba(0, 0, 0, 0.85);
    }

    /* ── Input bar ── */
    .input-bar {
      padding: 12px 16px 20px;
      background: #f9f9f9;
      flex-shrink: 0;
    }
    .input-area {
      max-width: 800px;
      margin: 0 auto;
      display: flex;
      align-items: flex-end;
      background: #fff;
      border: 1px solid #d9d9d9;
      border-radius: 20px;
      padding: 6px 6px 6px 16px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .input-area.focused {
      border-color: #999;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.05);
    }
    .input-area textarea {
      flex: 1;
      border: none;
      outline: none;
      resize: none;
      font-size: 14px;
      font-family: inherit;
      line-height: 1.5;
      padding: 6px 0;
      max-height: 200px;
      background: transparent;
      color: #1a1a1a;
    }
    .input-area textarea::placeholder {
      color: #aaa;
    }
    .input-area textarea:disabled {
      opacity: 0.5;
    }

    .send-button {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      background: #1a1a1a;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      opacity: 0;
      transform: scale(0.8);
      transition: opacity 0.15s, transform 0.15s, background 0.15s;
      pointer-events: none;
    }
    .send-button.visible {
      opacity: 1;
      transform: scale(1);
      pointer-events: auto;
    }
    .send-button:hover:not(:disabled) {
      background: #333;
    }
    .send-button:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
  `],
})
export class ChatComponent implements OnDestroy, AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
  @ViewChild('inputField') private inputField!: ElementRef;

  messages: ChatMessage[] = [];
  inputText = '';
  inputFocused = false;
  isWaiting = false;
  pendingImageBase64: string | null = null;
  isDragging = false;
  private dragCounter = 0;
  private streamSub: Subscription | null = null;
  private shouldScroll = false;
  private currentAssistant: ChatMessage | null = null;

  private readonly IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

  constructor(public claude: ClaudeService, private cdr: ChangeDetectorRef) {}

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  ngOnDestroy() {
    this.streamSub?.unsubscribe();
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  autoResize(event: Event) {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  onPaste(event: ClipboardEvent) {
    const files = event.clipboardData?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (this.IMAGE_TYPES.includes(file.type)) {
        event.preventDefault();
        this.readImageFile(file);
      }
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isDragging) {
      this.dragCounter++;
      this.isDragging = true;
    }
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter--;
    if (this.dragCounter <= 0) {
      this.dragCounter = 0;
      this.isDragging = false;
    }
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
    this.dragCounter = 0;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (this.IMAGE_TYPES.includes(file.type)) {
        this.readImageFile(file);
      }
    }
  }

  removeImage() {
    this.pendingImageBase64 = null;
  }

  private readImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip the "data:image/...;base64," prefix
      this.pendingImageBase64 = dataUrl.split(',')[1] || null;
      this.cdr.detectChanges();
    };
    reader.readAsDataURL(file);
  }

  sendExample(text: string) {
    this.inputText = text;
    this.send();
  }

  send() {
    const text = this.inputText.trim();
    const image = this.pendingImageBase64;
    if ((!text && !image) || this.claude.isStreaming) return;

    const displayContent = image ? (text || '(image)') : text;
    this.messages.push({ role: 'user', content: displayContent, tools: [] });
    this.inputText = '';
    this.pendingImageBase64 = null;
    this.shouldScroll = true;
    this.isWaiting = true;

    // Reset textarea height
    if (this.inputField?.nativeElement) {
      this.inputField.nativeElement.style.height = 'auto';
    }

    const assistantMsg: ChatMessage = { role: 'assistant', content: '', tools: [], thinking: '' };
    this.messages.push(assistantMsg);
    this.currentAssistant = assistantMsg;

    this.streamSub = this.claude.sendMessage(text, image || undefined).subscribe({
      next: (event: StreamEvent) => {
        this.isWaiting = false;

        switch (event.type) {
          case 'text':
            assistantMsg.content += event.content || '';
            break;

          case 'thought':
            assistantMsg.thinking = (assistantMsg.thinking || '') + (event.content || '');
            break;

          case 'tool': {
            const toolBlock: ToolBlock = {
              id: event.toolCallId || String(Date.now()),
              name: event.title || event.name || 'Tool',
              input: event.input || '',
              status: event.status || 'running',
              output: '',
              expanded: false,
            };
            assistantMsg.tools.push(toolBlock);
            break;
          }

          case 'tool_update': {
            const existing = assistantMsg.tools.find(t => t.id === event.toolCallId);
            if (existing) {
              if (event.status) existing.status = event.status;
              if (event.content) existing.output += event.content;
            }
            break;
          }

          case 'error':
            assistantMsg.error = event.content || 'Unknown error';
            break;
        }

        this.shouldScroll = true;
      },
      error: (err) => {
        this.isWaiting = false;
        assistantMsg.error = assistantMsg.error || err.message || 'Something went wrong';
        this.currentAssistant = null;
      },
      complete: () => {
        this.isWaiting = false;
        if (!assistantMsg.content && !assistantMsg.tools.length && !assistantMsg.error) {
          assistantMsg.content = '(No response)';
        }
        // Mark all tools as done
        for (const tool of assistantMsg.tools) {
          if (tool.status === 'running' || tool.status === 'in_progress') {
            tool.status = 'completed';
          }
        }
        this.currentAssistant = null;
      },
    });
  }

  truncate(text: string, max: number): string {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '...' : text;
  }

  formatMarkdown(content: string): string {
    let html = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g,
      '<pre style="background:#f4f4f5;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.5;margin:8px 0"><code>$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g,
      '<code style="background:#f4f4f5;padding:1px 5px;border-radius:3px;font-size:12px">$1</code>');
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    // Unordered lists
    html = html.replace(/^[-*] (.+)$/gm, '<li style="margin-left:20px;margin-bottom:2px">$1</li>');
    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:20px;margin-bottom:2px">$1</li>');
    // Line breaks (not inside pre blocks)
    html = html.replace(/\n/g, '<br>');
    // Clean up double breaks after block elements
    html = html.replace(/(<\/pre>)<br>/g, '$1');
    html = html.replace(/(<\/li>)<br>/g, '$1');

    return html;
  }

  private scrollToBottom() {
    try {
      const el = this.messagesContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch {}
  }
}
