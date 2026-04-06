import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  checkTool: (tool: string) => ipcRenderer.invoke('check-tool', tool),
  installTool: (tool: string) => ipcRenderer.invoke('install-tool', tool),
  claudeChat: (message: string, workDir: string) => ipcRenderer.invoke('claude-chat', message, workDir),
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
});
