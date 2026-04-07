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
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enabled: boolean) => ipcRenderer.invoke('set-autostart', enabled),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
});
