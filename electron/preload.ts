import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  checkTool: (tool: string) => ipcRenderer.invoke('check-tool', tool),
  installTool: (tool: string) => ipcRenderer.invoke('install-tool', tool),
  installNodejs: () => ipcRenderer.invoke('install-nodejs'),
  installClaude: () => ipcRenderer.invoke('install-claude'),
  installOpenclaw: () => ipcRenderer.invoke('install-openclaw'),
  onInstallProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('install-progress', (_, data) => callback(data));
  },
  removeInstallProgressListeners: () => {
    ipcRenderer.removeAllListeners('install-progress');
  },
  getConfig: () => ipcRenderer.invoke('get-config'),
  claudeConnect: (workDir: string) => ipcRenderer.invoke('claude-connect', workDir),
  claudeDisconnect: () => ipcRenderer.invoke('claude-disconnect'),
  claudeCancel: () => ipcRenderer.invoke('claude-cancel'),
  claudeChat: (message: string, workDir: string, imageBase64?: string | string[]) => ipcRenderer.invoke('claude-chat', message, workDir, imageBase64),
  onClaudeStream: (callback: (data: any) => void) => {
    ipcRenderer.on('claude-stream', (_, data) => callback(data));
  },
  onClaudeStreamEnd: (callback: (data: any) => void) => {
    ipcRenderer.on('claude-stream-end', (_, data) => callback(data));
  },
  removeStreamListeners: () => {
    ipcRenderer.removeAllListeners('claude-stream');
    ipcRenderer.removeAllListeners('claude-stream-end');
  },
  getOpenclawStatus: () => ipcRenderer.invoke('openclaw-status'),
  restartOpenclaw: () => ipcRenderer.invoke('openclaw-restart'),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enabled: boolean) => ipcRenderer.invoke('set-autostart', enabled),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  // Conversation history
  getConversations: () => ipcRenderer.invoke('get-conversations'),
  saveConversation: (conv: any) => ipcRenderer.invoke('save-conversation', conv),
  deleteConversation: (id: string) => ipcRenderer.invoke('delete-conversation', id),
  // Session management for conversation switching
  claudeNewSession: (workDir: string, resumeSessionId?: string) => ipcRenderer.invoke('claude-new-session', workDir, resumeSessionId),
  // File tree
  listDirectory: (dirPath: string) => ipcRenderer.invoke('list-directory', dirPath),
  // Logs
  getLogs: (date?: string) => ipcRenderer.invoke('get-logs', date),
  getLogDir: () => ipcRenderer.invoke('get-log-dir'),
});
