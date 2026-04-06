import { Injectable } from '@angular/core';

export interface ToolStatus {
  name: string;
  installed: boolean;
  version: string | null;
  installing: boolean;
}

export interface AllToolsStatus {
  nodejs: ToolStatus;
  claude: ToolStatus;
  openclaw: ToolStatus;
}

@Injectable({ providedIn: 'root' })
export class InstallerService {

  async checkAll(): Promise<AllToolsStatus> {
    const [nodejs, claude, openclaw] = await Promise.all([
      window.electronAPI.checkTool('node'),
      window.electronAPI.checkTool('claude'),
      window.electronAPI.checkTool('openclaw'),
    ]);

    return {
      nodejs: { name: 'Node.js', installed: nodejs.installed, version: nodejs.version, installing: false },
      claude: { name: 'Claude Code', installed: claude.installed, version: claude.version, installing: false },
      openclaw: { name: 'OpenClaw', installed: openclaw.installed, version: openclaw.version, installing: false },
    };
  }

  async install(tool: 'claude' | 'openclaw'): Promise<{ success: boolean; output?: string; error?: string }> {
    return window.electronAPI.installTool(tool);
  }
}
