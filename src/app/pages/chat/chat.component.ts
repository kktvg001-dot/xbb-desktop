import { Component, OnDestroy, OnInit, ViewChild, ElementRef, AfterViewChecked, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClaudeService, StreamEvent, ConversationEntry } from '../../services/claude.service';
import { Subscription } from 'rxjs';

interface ToolBlock {
  id: string;
  name: string;
  input: string;
  status: string;
  output: string;
  expanded: boolean;
  /** For Edit/Write tools: parsed diff data */
  diffData?: DiffData;
}

interface DiffData {
  filePath: string;
  type: 'edit' | 'write';
  oldString?: string;
  newString?: string;
  content?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  tools: ToolBlock[];
  error?: string;
  thinking?: string;
  imageBase64?: string;
  showTools?: boolean;
  queued?: boolean;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="chat-layout">
      <!-- Conversation history sidebar -->
      <div class="conv-sidebar" [class.conv-sidebar-open]="sidebarOpen">
        <button class="new-chat-btn" (click)="newChat()">+ New Chat</button>
        <div class="conv-list">
          <ng-container *ngIf="groupedConversations.today.length > 0">
            <div class="conv-group-label">Today</div>
            <div class="conv-item"
              *ngFor="let c of groupedConversations.today"
              [class.conv-active]="c.id === currentConversationId"
              (click)="loadConversation(c)">
              <span class="conv-title">{{ c.title }}</span>
              <button class="conv-delete" (click)="deleteConversation(c.id, $event)">&times;</button>
            </div>
          </ng-container>
          <ng-container *ngIf="groupedConversations.yesterday.length > 0">
            <div class="conv-group-label">Yesterday</div>
            <div class="conv-item"
              *ngFor="let c of groupedConversations.yesterday"
              [class.conv-active]="c.id === currentConversationId"
              (click)="loadConversation(c)">
              <span class="conv-title">{{ c.title }}</span>
              <button class="conv-delete" (click)="deleteConversation(c.id, $event)">&times;</button>
            </div>
          </ng-container>
          <ng-container *ngIf="groupedConversations.previous.length > 0">
            <div class="conv-group-label">Previous</div>
            <div class="conv-item"
              *ngFor="let c of groupedConversations.previous"
              [class.conv-active]="c.id === currentConversationId"
              (click)="loadConversation(c)">
              <span class="conv-title">{{ c.title }}</span>
              <button class="conv-delete" (click)="deleteConversation(c.id, $event)">&times;</button>
            </div>
          </ng-container>
          <div class="conv-empty" *ngIf="conversations.length === 0">No conversations yet</div>
        </div>
      </div>

      <!-- Sidebar toggle (mobile) -->
      <button class="sidebar-toggle" (click)="sidebarOpen = !sidebarOpen">
        <span *ngIf="!sidebarOpen">&#9776;</span>
        <span *ngIf="sidebarOpen">&larr;</span>
      </button>

      <!-- Main chat area -->
      <div class="chat-container"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)">

      <!-- Model selector header -->
      <div class="model-header">
        <select [(ngModel)]="selectedModel" (ngModelChange)="onModelChange($event)" class="model-select">
          <option value="claude-sonnet-4-6">Sonnet 4.6</option>
          <option value="claude-opus-4-6">Opus 4.6</option>
          <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
          <option value="custom">Custom...</option>
        </select>
        <input
          *ngIf="selectedModel === 'custom'"
          [(ngModel)]="customModelId"
          (blur)="onCustomModelBlur()"
          (keydown.enter)="onCustomModelBlur()"
          class="model-custom-input"
          placeholder="model-id" />
      </div>
      <div class="chat-messages" #messagesContainer>

        <!-- Empty state -->
        <div class="empty-state" *ngIf="messages.length === 0 && !claude.isStreaming">
          <div class="empty-logo">✦</div>
          <h2>OpenClaw Assistant</h2>
          <p class="empty-desc">Your AI assistant that can read files, run commands, search the web, and help manage your WhatsApp bot — all from this chat.</p>
          <div class="suggestions">
            <button class="suggestion" (click)="sendExample('Help me set up my WhatsApp AI assistant')">
              🚀 Set up WhatsApp bot
            </button>
            <button class="suggestion" (click)="sendExample('Check if everything is running correctly on my system')">
              🔍 Check my system
            </button>
            <button class="suggestion" (click)="sendExample('My WhatsApp bot is not replying to messages, help me fix it')">
              🔧 Fix a problem
            </button>
            <button class="suggestion" (click)="sendExample('What can you do? Show me your capabilities')">
              💡 What can you do?
            </button>
          </div>
        </div>

        <!-- Messages -->
        <div class="messages-inner">
          <ng-container *ngFor="let msg of messages; let i = index">
            <!-- User message -->
            <div class="msg-row msg-user" *ngIf="msg.role === 'user'">
              <img *ngIf="msg.imageBase64"
                [src]="'data:image/png;base64,' + msg.imageBase64"
                class="user-image"
                (click)="previewImage(msg.imageBase64!)"
                alt="Sent image" />
              <div class="user-bubble" *ngIf="msg.content" [class.queued-msg]="msg.queued">
                {{ msg.content }}
                <span class="queued-tag" *ngIf="msg.queued">queued</span>
              </div>
            </div>

            <!-- Assistant message -->
            <div class="msg-row msg-assistant" *ngIf="msg.role === 'assistant'">
              <!-- Thinking block -->
              <div class="thinking-block" *ngIf="msg.thinking">
                <span class="thinking-label">Thinking</span>
                <span class="thinking-text">{{ truncate(msg.thinking, 120) }}</span>
              </div>

              <!-- Tool summary (collapsed by default) -->
              <div class="tool-summary" *ngIf="msg.tools.length > 0">
                <div class="tool-summary-header" (click)="msg.showTools = !msg.showTools">
                  <span class="tool-icon">
                    <svg *ngIf="hasRunningTools(msg)" class="spinner" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="20 12" /></svg>
                    <span *ngIf="!hasRunningTools(msg)">&#10003;</span>
                  </span>
                  <span class="tool-summary-text">{{ toolSummaryText(msg) }}</span>
                  <span class="tool-expand">{{ msg.showTools ? '&#9650;' : '&#9660;' }}</span>
                </div>
                <div class="tool-details" *ngIf="msg.showTools">
                  <div class="tool-card" *ngFor="let tool of msg.tools"
                    [class.tool-done]="tool.status === 'completed' || tool.status === 'done'"
                    [class.tool-running]="tool.status === 'running' || tool.status === 'in_progress'"
                    [class.tool-file-change]="isFileChangeTool(tool)">
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
                      <!-- Diff view for Edit/Write tools -->
                      <ng-container *ngIf="tool.diffData; else defaultToolBody">
                        <div class="diff-container">
                          <div class="diff-file-header">
                            <span class="diff-file-icon" *ngIf="tool.diffData.type === 'edit'">M</span>
                            <span class="diff-file-icon diff-file-created" *ngIf="tool.diffData.type === 'write'">+</span>
                            <span class="diff-file-path">{{ tool.diffData.filePath }}</span>
                          </div>
                          <!-- Edit: show old_string -> new_string diff -->
                          <div class="diff-body" *ngIf="tool.diffData.type === 'edit' && (tool.diffData.oldString || tool.diffData.newString)">
                            <div class="diff-section" *ngIf="tool.diffData.oldString">
                              <div class="diff-line diff-removed" *ngFor="let line of splitLines(tool.diffData.oldString)">
                                <span class="diff-prefix">-</span><span class="diff-text">{{ line }}</span>
                              </div>
                            </div>
                            <div class="diff-section" *ngIf="tool.diffData.newString">
                              <div class="diff-line diff-added" *ngFor="let line of splitLines(tool.diffData.newString)">
                                <span class="diff-prefix">+</span><span class="diff-text">{{ line }}</span>
                              </div>
                            </div>
                          </div>
                          <!-- Write: show content preview -->
                          <div class="diff-body" *ngIf="tool.diffData.type === 'write' && tool.diffData.content">
                            <div class="diff-line diff-added" *ngFor="let line of splitLines(truncate(tool.diffData.content, 2000))">
                              <span class="diff-prefix">+</span><span class="diff-text">{{ line }}</span>
                            </div>
                          </div>
                          <!-- Fallback when no diff content available -->
                          <div class="diff-body diff-no-content" *ngIf="!tool.diffData.oldString && !tool.diffData.newString && !tool.diffData.content">
                            <span>File {{ tool.diffData.type === 'edit' ? 'modified' : 'written' }} successfully</span>
                          </div>
                        </div>
                        <div class="tool-output" *ngIf="tool.output && !tool.diffData.oldString && !tool.diffData.newString && !tool.diffData.content">
                          <pre>{{ truncate(tool.output, 2000) }}</pre>
                        </div>
                      </ng-container>
                      <!-- Default view for non-file tools -->
                      <ng-template #defaultToolBody>
                        <div class="tool-input-full" *ngIf="tool.input">
                          <pre>{{ tool.input }}</pre>
                        </div>
                        <div class="tool-output" *ngIf="tool.output">
                          <pre>{{ truncate(tool.output, 2000) }}</pre>
                        </div>
                      </ng-template>
                    </div>
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

          <!-- Activity indicator -->
          <div class="activity-indicator" *ngIf="claude.isStreaming && !isWaiting">
            <div class="activity-dot"></div>
            <span>{{ currentActivity }}</span>
          </div>
        </div>
      </div>

      <!-- Follow-up suggestions after response -->
      <div class="follow-ups" *ngIf="followUpSuggestions.length > 0 && !claude.isStreaming">
        <button class="follow-up-btn" *ngFor="let s of followUpSuggestions" (click)="sendFollowUp(s)">
          {{ s }}
        </button>
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
            [placeholder]="claude.isStreaming ? 'Type to queue message...' : 'Message Claude...'"
            rows="1"></textarea>
          <!-- queued messages now shown in conversation list -->
          <button
            class="mic-btn"
            [class.recording]="isRecording"
            (click)="toggleSpeechInput()"
            title="Voice input">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1z" fill="currentColor"/>
              <path d="M4 7v.5a4 4 0 0 0 8 0V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M8 12.5V15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M5.5 15h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            *ngIf="claude.isStreaming"
            class="stop-btn"
            (click)="stopGeneration()">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="2" width="10" height="10" rx="1.5" fill="white"/>
            </svg>
          </button>
          <button
            *ngIf="!claude.isStreaming"
            class="send-button"
            (click)="send()"
            [class.visible]="inputText.trim().length > 0 || !!pendingImageBase64"
            [disabled]="!inputText.trim() && !pendingImageBase64">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 14V2M8 2L3 7M8 2L13 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="input-hints">
          <button class="shortcuts-hint" (click)="showShortcutsHelp = true" title="Keyboard shortcuts (Ctrl+/)">
            <span>?</span> Shortcuts
          </button>
        </div>
      </div>
    </div><!-- /chat-container -->
    <!-- Image lightbox -->
    <div class="image-lightbox" *ngIf="lightboxImage" (click)="lightboxImage = null">
      <img [src]="'data:image/png;base64,' + lightboxImage" alt="Preview" />
    </div>
    <!-- Keyboard shortcuts help overlay -->
    <div class="shortcuts-overlay" *ngIf="showShortcutsHelp" (click)="showShortcutsHelp = false">
      <div class="shortcuts-dialog" (click)="$event.stopPropagation()">
        <div class="shortcuts-header">
          <h3>Keyboard Shortcuts</h3>
          <button class="shortcuts-close" (click)="showShortcutsHelp = false">&times;</button>
        </div>
        <div class="shortcuts-body">
          <div class="shortcut-row"><kbd>Ctrl</kbd> + <kbd>N</kbd><span>New chat</span></div>
          <div class="shortcut-row"><kbd>Ctrl</kbd> + <kbd>L</kbd><span>Clear current chat</span></div>
          <div class="shortcut-row"><kbd>Escape</kbd><span>Stop generation</span></div>
          <div class="shortcut-row"><kbd>Ctrl</kbd> + <kbd>/</kbd><span>Show shortcuts</span></div>
          <div class="shortcut-row"><kbd>Enter</kbd><span>Send message</span></div>
          <div class="shortcut-row"><kbd>Shift</kbd> + <kbd>Enter</kbd><span>New line</span></div>
        </div>
      </div>
    </div>
    </div><!-- /chat-layout -->
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    /* ── Chat layout with sidebar ── */
    .chat-layout {
      display: flex;
      height: 100%;
      position: relative;
    }

    .conv-sidebar {
      width: 250px;
      min-width: 250px;
      background: var(--bg-sidebar);
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border);
      overflow: hidden;
    }

    .new-chat-btn {
      margin: 12px;
      padding: 10px 16px;
      background: var(--accent-gradient);
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      flex-shrink: 0;
    }
    .new-chat-btn:hover {
      box-shadow: 0 4px 16px var(--accent-glow);
      transform: translateY(-1px);
    }

    .conv-list {
      flex: 1;
      overflow-y: auto;
      padding: 0 0 12px;
    }

    .conv-group-label {
      padding: 12px 16px 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }

    .conv-item {
      display: flex;
      align-items: center;
      padding: 8px 12px 8px 16px;
      cursor: pointer;
      transition: all 0.15s ease;
      border-left: 3px solid transparent;
      position: relative;
      border-radius: 0 8px 8px 0;
      margin-right: 8px;
    }
    .conv-item:hover {
      background: var(--bg-hover);
    }
    .conv-item.conv-active {
      background: rgba(124, 92, 252, 0.1);
      border-left-color: var(--accent);
    }

    .conv-title {
      flex: 1;
      min-width: 0;
      color: var(--text-secondary);
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .conv-item.conv-active .conv-title {
      color: var(--text-primary);
    }

    .conv-delete {
      display: none;
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 16px;
      cursor: pointer;
      padding: 2px 4px;
      line-height: 1;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .conv-item:hover .conv-delete {
      display: block;
    }
    .conv-delete:hover {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.15);
    }

    .conv-empty {
      padding: 20px 16px;
      color: var(--text-muted);
      font-size: 13px;
      text-align: center;
    }

    .sidebar-toggle {
      display: none;
      position: absolute;
      top: 8px;
      left: 8px;
      z-index: 50;
      width: 32px;
      height: 32px;
      background: var(--bg-card);
      color: var(--text-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      align-items: center;
      justify-content: center;
    }
    .sidebar-toggle:hover {
      background: var(--bg-hover);
    }

    @media (max-width: 768px) {
      .conv-sidebar {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        z-index: 40;
        transform: translateX(-100%);
        transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .conv-sidebar.conv-sidebar-open {
        transform: translateX(0);
        box-shadow: 8px 0 24px rgba(0, 0, 0, 0.3);
      }
      .sidebar-toggle {
        display: flex;
      }
    }

    .chat-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      flex: 1;
      min-width: 0;
      background: var(--bg-primary);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    /* ── Model selector header ── */
    .model-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
      flex-shrink: 0;
    }

    .model-select {
      font-size: 12px;
      padding: 5px 24px 5px 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg-input);
      color: var(--text-secondary);
      outline: none;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%238888aa' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 8px center;
      transition: all 0.2s ease;
    }
    .model-select:hover {
      border-color: var(--border-hover);
    }
    .model-select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-glow);
    }

    .model-custom-input {
      font-size: 12px;
      font-family: 'Inter', sans-serif;
      padding: 5px 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg-input);
      color: var(--text-primary);
      outline: none;
      width: 180px;
      transition: all 0.2s ease;
    }
    .model-custom-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-glow);
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
      animation: emptyFadeIn 0.5s ease;
    }
    @keyframes emptyFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .empty-logo {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: var(--accent-gradient);
      color: #fff;
      font-size: 26px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 24px;
      box-shadow: 0 8px 24px var(--accent-glow);
    }
    .empty-state h2 {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0 0 24px;
      letter-spacing: -0.5px;
    }
    .suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: center;
    }
    .suggestion {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 18px;
      font-size: 13px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .suggestion:hover {
      border-color: var(--accent);
      color: var(--text-primary);
      background: var(--bg-hover);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px var(--accent-glow);
    }

    /* ── Message rows ── */
    .msg-row {
      display: flex;
      flex-direction: column;
    }

    /* ── User messages ── */
    .msg-user {
      align-items: flex-end;
      animation: msgSlideInRight 0.3s ease;
    }
    @keyframes msgSlideInRight {
      from { opacity: 0; transform: translateX(16px); }
      to { opacity: 1; transform: translateX(0); }
    }
    .user-image {
      max-width: 250px;
      max-height: 200px;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-bottom: 4px;
    }
    .user-image:hover { opacity: 0.85; transform: scale(0.98); }
    .image-lightbox {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      cursor: pointer;
    }
    .image-lightbox img {
      max-width: 90vw;
      max-height: 90vh;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }
    .user-bubble {
      background: var(--accent-gradient);
      color: #fff;
      padding: 10px 16px;
      border-radius: 18px 18px 4px 18px;
      font-size: 14px;
      line-height: 1.6;
      max-width: 75%;
      white-space: pre-wrap;
      word-break: break-word;
      box-shadow: 0 2px 8px var(--accent-glow);
    }

    /* ── Assistant messages ── */
    .msg-assistant {
      align-items: flex-start;
      gap: 8px;
      animation: msgSlideInLeft 0.3s ease;
    }
    @keyframes msgSlideInLeft {
      from { opacity: 0; transform: translateX(-16px); }
      to { opacity: 1; transform: translateX(0); }
    }

    .assistant-text {
      font-size: 14px;
      line-height: 1.7;
      color: var(--text-primary);
      max-width: 100%;
      word-break: break-word;
    }

    /* Markdown rendered content */
    .assistant-text :first-child { margin-top: 0; }
    .assistant-text :last-child { margin-bottom: 0; }

    /* ── Code blocks ── */
    .code-block-wrapper { position: relative; margin: 12px 0; }
    .code-block-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #1a1a30;
      padding: 8px 14px;
      border-radius: 10px 10px 0 0;
      font-size: 12px;
      color: var(--text-muted);
      border: 1px solid var(--border);
      border-bottom: none;
    }
    .code-lang { font-family: 'JetBrains Mono', monospace; }
    .copy-btn {
      background: none;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 3px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
      font-family: inherit;
      transition: all 0.15s ease;
    }
    .copy-btn:hover { color: #fff; border-color: var(--accent); }
    .copy-btn.copied { color: var(--accent); border-color: var(--accent); }
    pre.code-block {
      background: #0d0d1a;
      color: #e0e0e0;
      padding: 16px;
      margin: 0;
      border-radius: 0 0 10px 10px;
      overflow-x: auto;
      font-size: 13px;
      line-height: 1.6;
      font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
      border: 1px solid var(--border);
      border-top: none;
    }
    pre.code-block code { font-family: inherit; background: none; padding: 0; }

    /* ── Thinking ── */
    .thinking-block {
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-size: 12px;
      color: var(--text-muted);
      padding: 4px 0;
    }
    .thinking-label {
      font-weight: 600;
      color: var(--accent);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }
    .thinking-text {
      font-style: italic;
      color: var(--text-muted);
    }

    /* ── Tool summary ── */
    .tool-summary {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      font-size: 13px;
      max-width: 100%;
    }
    .tool-summary-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      cursor: pointer;
      user-select: none;
      background: var(--bg-card);
      transition: background 0.15s ease;
    }
    .tool-summary-header:hover {
      background: var(--bg-hover);
    }
    .tool-summary-text {
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
      min-width: 0;
    }
    .tool-details {
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .tool-details .tool-card {
      border-radius: 0;
      border-left: none;
      border-right: none;
      border-bottom: none;
    }
    .tool-details .tool-card:first-child {
      border-top: none;
    }

    /* ── Tool cards ── */
    .tool-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      font-size: 13px;
      max-width: 100%;
      transition: border-color 0.2s ease;
    }
    .tool-card.tool-running {
      border-color: #f59e0b;
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.1);
    }
    .tool-card.tool-done {
      border-color: var(--border);
    }
    .tool-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      cursor: pointer;
      user-select: none;
      background: var(--bg-card);
      transition: background 0.15s ease;
    }
    .tool-header:hover {
      background: var(--bg-hover);
    }
    .tool-icon {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
      font-size: 12px;
      flex-shrink: 0;
    }
    .tool-card.tool-running .tool-icon {
      color: #f59e0b;
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
      color: var(--text-primary);
      flex-shrink: 0;
    }
    .tool-input-preview {
      color: var(--text-muted);
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .tool-expand {
      color: var(--text-muted);
      font-size: 10px;
      flex-shrink: 0;
    }
    .tool-body {
      border-top: 1px solid var(--border);
      max-height: 300px;
      overflow-y: auto;
    }
    .tool-input-full,
    .tool-output {
      padding: 8px 12px;
    }
    .tool-input-full {
      background: var(--bg-input);
    }
    .tool-output {
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
    }
    .tool-body pre {
      margin: 0;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--text-secondary);
      border: none;
      background: transparent;
      padding: 0;
    }

    /* ── File change tool card ── */
    .tool-card.tool-file-change.tool-done {
      border-color: rgba(34, 197, 94, 0.3);
    }

    /* ── Diff viewer ── */
    .diff-container {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 12px;
      line-height: 1.6;
    }
    .diff-file-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: #f1f5f9;
      border-bottom: 1px solid #e2e8f0;
      font-weight: 600;
      color: #334155;
    }
    .diff-file-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      background: #fbbf24;
      color: #78350f;
      flex-shrink: 0;
    }
    .diff-file-icon.diff-file-created {
      background: #34d399;
      color: #064e3b;
    }
    .diff-file-path {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      direction: rtl;
      text-align: left;
    }
    .diff-body {
      max-height: 300px;
      overflow-y: auto;
      padding: 4px 0;
    }
    .diff-body.diff-no-content {
      padding: 12px;
      color: #6b7280;
      font-style: italic;
      font-family: inherit;
    }
    .diff-section {
      margin: 0;
    }
    .diff-section + .diff-section {
      border-top: 1px dashed #e5e7eb;
      margin-top: 2px;
      padding-top: 2px;
    }
    .diff-line {
      display: flex;
      padding: 0 12px;
      min-height: 20px;
    }
    .diff-line.diff-removed {
      background: #fef2f2;
      color: #991b1b;
    }
    .diff-line.diff-added {
      background: #f0fdf4;
      color: #166534;
    }
    .diff-prefix {
      width: 16px;
      flex-shrink: 0;
      font-weight: 700;
      user-select: none;
    }
    .diff-line.diff-removed .diff-prefix {
      color: #dc2626;
    }
    .diff-line.diff-added .diff-prefix {
      color: #16a34a;
    }
    .diff-text {
      white-space: pre-wrap;
      word-break: break-all;
      flex: 1;
      min-width: 0;
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

    /* ── Activity indicator ── */
    .activity-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      color: #6b7280;
      font-size: 13px;
    }
    .activity-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #00a884;
      animation: pulse 1.5s infinite;
      flex-shrink: 0;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    /* ── Stop button ── */
    .stop-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #ef4444;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .stop-btn:hover {
      background: #dc2626;
    }

    /* ── Mic button ── */
    .mic-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: #999;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: color 0.15s, background 0.15s;
    }
    .mic-btn:hover {
      color: #555;
      background: #f0f0f0;
    }
    .mic-btn.recording {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.1);
      animation: micPulse 1.5s ease-in-out infinite;
    }
    @keyframes micPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.3); }
      50% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
    }

    /* ── Input hints ── */
    .input-hints {
      max-width: 800px;
      margin: 4px auto 0;
      display: flex;
      justify-content: flex-end;
    }
    .shortcuts-hint {
      background: none;
      border: none;
      color: #aaa;
      font-size: 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border-radius: 4px;
      transition: color 0.15s, background 0.15s;
    }
    .shortcuts-hint:hover {
      color: #666;
      background: rgba(0,0,0,0.04);
    }
    .shortcuts-hint span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 3px;
      background: #e5e5e5;
      color: #666;
      font-size: 11px;
      font-weight: 600;
    }

    /* ── Shortcuts overlay ── */
    .shortcuts-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .shortcuts-dialog {
      background: #fff;
      border-radius: 12px;
      width: 360px;
      max-width: 90vw;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
      overflow: hidden;
    }
    .shortcuts-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid #eee;
    }
    .shortcuts-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: #1a1a1a;
    }
    .shortcuts-close {
      background: none;
      border: none;
      font-size: 20px;
      color: #999;
      cursor: pointer;
      padding: 0;
      line-height: 1;
    }
    .shortcuts-close:hover { color: #333; }
    .shortcuts-body {
      padding: 12px 20px 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .shortcut-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #666;
    }
    .shortcut-row span {
      margin-left: auto;
      color: #333;
    }
    .shortcut-row kbd {
      display: inline-block;
      padding: 2px 7px;
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 12px;
      font-family: inherit;
      color: #444;
      box-shadow: 0 1px 0 #ccc;
    }

    /* ── Queued message styles ── */
    .queued-msg {
      opacity: 0.6;
      background: #6b7280 !important;
    }
    .queued-tag {
      display: inline-block;
      font-size: 10px;
      background: rgba(255,255,255,0.3);
      border-radius: 8px;
      padding: 1px 6px;
      margin-left: 6px;
      vertical-align: middle;
    }
    .queued-badge {
      font-size: 11px;
      color: #059669;
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      border-radius: 10px;
      padding: 2px 8px;
      white-space: nowrap;
      flex-shrink: 0;
      margin-right: 4px;
    }
  `],
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
  @ViewChild('inputField') private inputField!: ElementRef;

  messages: ChatMessage[] = [];
  inputText = '';
  inputFocused = false;
  isWaiting = false;
  pendingImageBase64: string | null = null;
  isDragging = false;
  lightboxImage: string | null = null;
  currentActivity = 'Thinking...';
  pendingQueue: string[] = [];
  followUpSuggestions: string[] = [];

  // Speech input state
  isRecording = false;
  private currentRecognition: any = null;

  // Keyboard shortcuts help
  showShortcutsHelp = false;

  // Conversation sidebar state
  conversations: ConversationEntry[] = [];
  currentConversationId: string | null = null;
  sidebarOpen = false;
  groupedConversations: { today: ConversationEntry[]; yesterday: ConversationEntry[]; previous: ConversationEntry[] } = { today: [], yesterday: [], previous: [] };

  // Model selector state
  selectedModel: string = localStorage.getItem('xbb-selected-model') || 'claude-sonnet-4-6';
  customModelId: string = localStorage.getItem('xbb-custom-model') || '';

  onModelChange(model: string) {
    if (model !== 'custom') {
      localStorage.setItem('xbb-selected-model', model);
    }
  }

  onCustomModelBlur() {
    const id = this.customModelId.trim();
    if (id) {
      localStorage.setItem('xbb-custom-model', id);
      localStorage.setItem('xbb-selected-model', id);
    }
  }

  getActiveModel(): string {
    if (this.selectedModel === 'custom') {
      return this.customModelId.trim() || 'claude-sonnet-4-6';
    }
    return this.selectedModel;
  }

  previewImage(base64: string) {
    this.lightboxImage = base64;
  }
  private dragCounter = 0;
  private streamSub: Subscription | null = null;
  private shouldScroll = false;
  private currentAssistant: ChatMessage | null = null;

  private readonly IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

  constructor(public claude: ClaudeService, private cdr: ChangeDetectorRef) {}

  async ngOnInit() {
    await this.loadConversations();
  }

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

  stopGeneration() {
    window.electronAPI.claudeCancel();
    this.claude.isStreaming = false;
    this.currentActivity = '';
    this.isWaiting = false;
    this.streamSub?.unsubscribe();
    window.electronAPI.removeStreamListeners();
    // Mark running tools as completed
    if (this.currentAssistant) {
      for (const tool of this.currentAssistant.tools) {
        if (tool.status === 'running' || tool.status === 'in_progress') {
          tool.status = 'completed';
        }
      }
      this.currentAssistant = null;
    }
  }

  send() {
    const text = this.inputText.trim();
    const image = this.pendingImageBase64;
    if (!text && !image) return;

    // Queue the message if Claude is currently streaming — show it in the conversation
    if (this.claude.isStreaming) {
      this.messages.push({ role: 'user', content: text, tools: [], imageBase64: image || undefined, queued: true });
      this.pendingQueue.push(text);
      this.inputText = '';
      this.pendingImageBase64 = null;
      if (this.inputField?.nativeElement) {
        this.inputField.nativeElement.style.height = 'auto';
      }
      this.shouldScroll = true;
      return;
    }

    const displayContent = text || '';
    this.messages.push({ role: 'user', content: displayContent, tools: [], imageBase64: image || undefined });
    this.inputText = '';
    this.pendingImageBase64 = null;
    this.shouldScroll = true;
    this.isWaiting = true;

    // Ensure conversation entry exists
    this.ensureConversation();

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
            this.currentActivity = 'Thinking...';
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
            // Initialize diff data for file-changing tools
            if (this.isFileChangeTool(toolBlock)) {
              const toolName = (toolBlock.name || '').toLowerCase();
              toolBlock.diffData = {
                filePath: toolBlock.input || 'unknown file',
                type: toolName.includes('edit') ? 'edit' : 'write',
              };
            }
            assistantMsg.tools.push(toolBlock);
            // Update activity indicator based on tool name
            const toolName = toolBlock.name;
            if (toolName.includes('Read')) this.currentActivity = '\u{1F4D6} Reading file...';
            else if (toolName.includes('Write') || toolName.includes('Edit')) this.currentActivity = '\u{270F}\u{FE0F} Writing...';
            else if (toolName.includes('Bash')) this.currentActivity = '\u{1F4BB} Running command...';
            else if (/search|Web|Grep|Glob/i.test(toolName)) this.currentActivity = '\u{1F50D} Searching...';
            else this.currentActivity = '\u{1F527} ' + toolName + '...';
            break;
          }

          case 'tool_update': {
            const existing = assistantMsg.tools.find(t => t.id === event.toolCallId);
            if (existing) {
              if (event.status) existing.status = event.status;
              if (event.content) existing.output += event.content;
              // Update diff data when tool completes
              if (this.isFileChangeTool(existing) && (event.status === 'completed' || event.status === 'done')) {
                this.parseDiffFromOutput(existing);
              }
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
        this.currentActivity = '';
        assistantMsg.error = assistantMsg.error || err.message || 'Something went wrong';
        this.currentAssistant = null;
        this.saveCurrentConversation();
      },
      complete: () => {
        this.isWaiting = false;
        this.currentActivity = '';
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

        // Generate follow-up suggestions based on response
        this.followUpSuggestions = this.generateFollowUps(assistantMsg.content, assistantMsg.tools);

        // Save conversation after response completes
        this.saveCurrentConversation();

        // Send queued message if any
        if (this.pendingQueue.length > 0) {
          const nextMsg = this.pendingQueue.shift()!;
          this.inputText = nextMsg;
          setTimeout(() => this.send(), 100);
        }
      },
    });
  }

  // ── Conversation history management ──

  async loadConversations() {
    try {
      this.conversations = await window.electronAPI.getConversations();
    } catch {
      this.conversations = [];
    }
    this.groupConversations();
  }

  private groupConversations() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;

    this.groupedConversations = { today: [], yesterday: [], previous: [] };
    for (const c of this.conversations) {
      if (c.timestamp >= todayStart) {
        this.groupedConversations.today.push(c);
      } else if (c.timestamp >= yesterdayStart) {
        this.groupedConversations.yesterday.push(c);
      } else {
        this.groupedConversations.previous.push(c);
      }
    }
  }

  private async saveCurrentConversation() {
    if (!this.currentConversationId) return;
    const conv = this.conversations.find(c => c.id === this.currentConversationId);
    if (!conv) return;
    // Serialize messages (strip heavy fields for storage)
    conv.messages = this.messages.map(m => ({
      role: m.role,
      content: m.content,
      error: m.error,
      thinking: m.thinking ? m.thinking.substring(0, 200) : undefined,
      tools: m.tools.map(t => ({ name: t.name, input: t.input.substring(0, 200), status: t.status })),
    }));
    // Update title from first user message
    const firstUser = this.messages.find(m => m.role === 'user' && m.content);
    if (firstUser && conv.title === 'New Chat') {
      conv.title = firstUser.content.substring(0, 50);
    }
    try {
      await window.electronAPI.saveConversation(conv);
    } catch {}
  }

  private ensureConversation(sessionId?: string) {
    if (this.currentConversationId) return;
    const id = 'conv-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    const conv: ConversationEntry = {
      id,
      sessionId: sessionId || '',
      title: 'New Chat',
      timestamp: Date.now(),
      messages: [],
    };
    this.conversations.unshift(conv);
    this.currentConversationId = id;
    this.groupConversations();
  }

  async newChat() {
    // Save current conversation first
    await this.saveCurrentConversation();

    // Clear state
    this.messages = [];
    this.currentAssistant = null;
    this.isWaiting = false;
    this.currentActivity = '';
    this.pendingQueue = [];
    this.currentConversationId = null;

    // Stop any streaming
    if (this.claude.isStreaming) {
      this.stopGeneration();
    }

    // Create a new ACP session
    try {
      const result = await window.electronAPI.claudeNewSession(this.claude.getWorkDir());
      if (result.success && result.sessionId) {
        this.ensureConversation(result.sessionId);
      } else {
        // Session creation failed, still allow typing — it will auto-connect on send
        this.ensureConversation();
      }
    } catch {
      this.ensureConversation();
    }

    this.sidebarOpen = false;
    this.cdr.detectChanges();
  }

  async loadConversation(conv: ConversationEntry) {
    if (conv.id === this.currentConversationId) {
      this.sidebarOpen = false;
      return;
    }

    // Save current conversation
    await this.saveCurrentConversation();

    // Stop streaming
    if (this.claude.isStreaming) {
      this.stopGeneration();
    }

    // Load messages from conversation
    this.currentConversationId = conv.id;
    this.messages = (conv.messages || []).map((m: any) => ({
      role: m.role,
      content: m.content || '',
      tools: (m.tools || []).map((t: any) => ({
        id: t.name + '-' + Date.now(),
        name: t.name || 'Tool',
        input: t.input || '',
        status: t.status || 'completed',
        output: '',
        expanded: false,
      })),
      error: m.error,
      thinking: m.thinking,
      showTools: false,
    }));

    this.currentAssistant = null;
    this.isWaiting = false;
    this.currentActivity = '';
    this.pendingQueue = [];
    this.shouldScroll = true;

    // Try to resume ACP session
    try {
      const result = await window.electronAPI.claudeNewSession(
        this.claude.getWorkDir(),
        conv.sessionId || undefined,
      );
      if (result.success && result.sessionId) {
        conv.sessionId = result.sessionId;
      }
    } catch {
      // Resume failed — user can still see messages and start fresh
    }

    this.sidebarOpen = false;
    this.cdr.detectChanges();
  }

  async deleteConversation(id: string, event: Event) {
    event.stopPropagation();
    try {
      await window.electronAPI.deleteConversation(id);
    } catch {}
    this.conversations = this.conversations.filter(c => c.id !== id);
    this.groupConversations();

    if (this.currentConversationId === id) {
      this.currentConversationId = null;
      this.messages = [];
    }
    this.cdr.detectChanges();
  }

  truncate(text: string, max: number): string {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '...' : text;
  }

  generateFollowUps(content: string, tools: ToolBlock[]): string[] {
    const suggestions: string[] = [];
    const lower = (content || '').toLowerCase();
    const hadTools = tools.length > 0;
    const hadFileOps = tools.some(t =>
      (t.name || '').match(/edit|write|read|find|grep/i)
    );

    // Context-aware suggestions
    if (lower.includes('error') || lower.includes('failed') || lower.includes('not found')) {
      suggestions.push('Can you try a different approach?');
      suggestions.push('Show me the error details');
    } else if (lower.includes('installed') || lower.includes('set up') || lower.includes('configured')) {
      suggestions.push('Verify everything is working');
      suggestions.push('What should I do next?');
    } else if (lower.includes('whatsapp') || lower.includes('openclaw')) {
      suggestions.push('Check WhatsApp connection status');
      suggestions.push('Show me the current configuration');
    } else if (hadFileOps) {
      suggestions.push('Show me what you changed');
      suggestions.push('Undo the last change');
    } else if (hadTools) {
      suggestions.push('Explain what you just did');
      suggestions.push('Is there anything else to check?');
    }

    // Always add a generic useful one
    if (suggestions.length < 3) {
      suggestions.push('Tell me more');
    }

    return suggestions.slice(0, 3);
  }

  sendFollowUp(text: string) {
    this.followUpSuggestions = [];
    this.inputText = text;
    this.send();
  }

  hasRunningTools(msg: ChatMessage): boolean {
    return msg.tools.some(t => t.status === 'running' || t.status === 'in_progress');
  }

  toolSummaryText(msg: ChatMessage): string {
    const total = msg.tools.length;
    if (total === 1) return msg.tools[0].name;
    // Count by name
    const counts: Record<string, number> = {};
    for (const t of msg.tools) {
      counts[t.name] = (counts[t.name] || 0) + 1;
    }
    const parts = Object.entries(counts).map(([name, count]) =>
      count > 1 ? `${name} \u00D7${count}` : name
    );
    return `${total} operations (${parts.join(', ')})`;
  }

  /** Check if a tool is a file-changing tool (Edit/Write) */
  isFileChangeTool(tool: ToolBlock): boolean {
    const name = (tool.name || '').toLowerCase();
    return name.includes('edit') || name.includes('write');
  }

  /** Split a string into lines for diff display */
  splitLines(text: string): string[] {
    if (!text) return [];
    return text.split('\n');
  }

  /** Parse tool input to extract diff data for Edit/Write tools */
  private parseDiffFromOutput(tool: ToolBlock): void {
    const name = (tool.name || '').toLowerCase();
    if (!name.includes('edit') && !name.includes('write')) return;

    const filePath = tool.input || 'unknown file';

    if (name.includes('edit')) {
      // Try to parse old_string/new_string from the output text
      // The output typically contains the result message from the Edit tool
      const diffData: DiffData = { filePath, type: 'edit' };

      // Try parsing output for edit details
      if (tool.output) {
        // Some ACP outputs include the changes in structured text
        const oldMatch = tool.output.match(/old_string[:\s]*["']?([\s\S]*?)["']?\s*(?:new_string|$)/);
        const newMatch = tool.output.match(/new_string[:\s]*["']?([\s\S]*?)["']?\s*$/);
        if (oldMatch) diffData.oldString = oldMatch[1].trim();
        if (newMatch) diffData.newString = newMatch[1].trim();
      }

      tool.diffData = diffData;
    } else if (name.includes('write')) {
      const diffData: DiffData = { filePath, type: 'write' };

      // For Write tools, the output might contain file content preview
      if (tool.output && tool.output.length > 0) {
        // Only show content if it looks like actual file content (not just a success message)
        const isSuccessMsg = /^(The file|File|wrote|Written|Success)/i.test(tool.output.trim());
        if (!isSuccessMsg && tool.output.length > 20) {
          diffData.content = tool.output;
        }
      }

      tool.diffData = diffData;
    }
  }

  formatMarkdown(content: string): string {
    // Extract code blocks first, replace with placeholders
    const codeBlocks: string[] = [];
    let processed = content.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
      const escapedCode = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      // Store raw code for clipboard (escape single quotes and backslashes for JS string)
      const rawForClipboard = code.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      const langLabel = lang || 'code';
      const block = `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${langLabel}</span><button class="copy-btn" onclick="navigator.clipboard.writeText('${rawForClipboard}');this.textContent='Copied!';this.classList.add('copied');setTimeout(()=>{this.textContent='Copy';this.classList.remove('copied')},2000)">Copy</button></div><pre class="code-block"><code>${escapedCode}</code></pre></div>`;
      codeBlocks.push(block);
      return `%%CODEBLOCK_${codeBlocks.length - 1}%%`;
    });

    // Escape HTML in remaining text
    processed = processed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Inline code
    processed = processed.replace(/`([^`]+)`/g,
      '<code style="background:#2d2d3f;color:#e0e0e0;padding:1px 5px;border-radius:3px;font-size:12px">$1</code>');
    // Bold
    processed = processed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic
    processed = processed.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    // Unordered lists
    processed = processed.replace(/^[-*] (.+)$/gm, '<li style="margin-left:20px;margin-bottom:2px">$1</li>');
    // Ordered lists
    processed = processed.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:20px;margin-bottom:2px">$1</li>');
    // Line breaks (not inside pre blocks)
    processed = processed.replace(/\n/g, '<br>');
    // Clean up double breaks after block elements
    processed = processed.replace(/(<\/li>)<br>/g, '$1');

    // Restore code blocks
    codeBlocks.forEach((block, i) => {
      processed = processed.replace(`%%CODEBLOCK_${i}%%`, block);
    });

    // Clean up breaks around code blocks
    processed = processed.replace(/<br>(%%CODEBLOCK_|<div class="code-block-wrapper">)/g, '$1');
    processed = processed.replace(/(<\/div>)<br>/g, '$1');

    return processed;
  }

  // ── Speech Input ──

  toggleSpeechInput() {
    if (this.isRecording) {
      this.stopSpeechInput();
    } else {
      this.startSpeechInput();
    }
  }

  startSpeechInput() {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech recognition not supported in this browser');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      this.inputText = transcript;
      this.cdr.detectChanges();
    };

    recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error);
      this.isRecording = false;
      this.currentRecognition = null;
      this.cdr.detectChanges();
    };

    recognition.onend = () => {
      this.isRecording = false;
      this.currentRecognition = null;
      this.cdr.detectChanges();
    };

    this.isRecording = true;
    recognition.start();
    this.currentRecognition = recognition;
  }

  stopSpeechInput() {
    if (this.currentRecognition) {
      this.currentRecognition.stop();
      this.currentRecognition = null;
    }
    this.isRecording = false;
  }

  // ── Keyboard Shortcuts ──

  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcut(event: KeyboardEvent) {
    const ctrlOrMeta = event.ctrlKey || event.metaKey;

    // Ctrl+N / Cmd+N → New chat
    if (ctrlOrMeta && event.key === 'n') {
      event.preventDefault();
      this.newChat();
      return;
    }

    // Ctrl+L / Cmd+L → Clear current chat
    if (ctrlOrMeta && event.key === 'l') {
      event.preventDefault();
      this.clearCurrentChat();
      return;
    }

    // Escape → Stop generation (if streaming) or close shortcuts help
    if (event.key === 'Escape') {
      if (this.showShortcutsHelp) {
        this.showShortcutsHelp = false;
        return;
      }
      if (this.claude.isStreaming) {
        event.preventDefault();
        this.stopGeneration();
        return;
      }
    }

    // Ctrl+/ → Show keyboard shortcuts help
    if (ctrlOrMeta && event.key === '/') {
      event.preventDefault();
      this.showShortcutsHelp = !this.showShortcutsHelp;
      return;
    }
  }

  clearCurrentChat() {
    // Clear messages without creating a new session
    this.messages = [];
    this.currentAssistant = null;
    this.isWaiting = false;
    this.currentActivity = '';
    this.pendingQueue = [];
    if (this.claude.isStreaming) {
      this.stopGeneration();
    }
    this.cdr.detectChanges();
  }

  private scrollToBottom() {
    try {
      const el = this.messagesContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch {}
  }
}
