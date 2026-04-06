import { Injectable } from '@angular/core';

export interface ToolStatus {
  name: string;
  installed: boolean;
  version: string | null;
  installing: boolean;
}

export interface AllToolsStatus {
  claude: ToolStatus;
  openclaw: ToolStatus;
}

@Injectable({ providedIn: 'root' })
export class InstallerService {

  async checkAll(): Promise<AllToolsStatus> {
    const [claude, openclaw] = await Promise.all([
      (window as any).electronAPI.checkTool('claude'),
      (window as any).electronAPI.checkTool('openclaw'),
    ]);

    return {
      claude: { name: 'Claude Code', installed: claude.installed, version: claude.version, installing: false },
      openclaw: { name: 'OpenClaw', installed: openclaw.installed, version: openclaw.version, installing: false },
    };
  }

  async install(tool: 'claude' | 'openclaw'): Promise<{ success: boolean; output?: string; error?: string }> {
    return (window as any).electronAPI.installTool(tool);
  }

  async installClaude(): Promise<{ success: boolean; output?: string }> {
    const config = await (window as any).electronAPI.getConfig();
    return (window as any).electronAPI.installClaude(config.apiBaseUrl, config.apiKey);
  }

  async installOpenclaw(): Promise<{ success: boolean; output?: string }> {
    return (window as any).electronAPI.installOpenclaw();
  }

  onInstallProgress(callback: (data: any) => void): void {
    (window as any).electronAPI.onInstallProgress(callback);
  }

  removeInstallProgressListeners(): void {
    (window as any).electronAPI.removeInstallProgressListeners();
  }
}
