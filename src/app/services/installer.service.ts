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
      (window as any).electronAPI.checkTool('node'),
      (window as any).electronAPI.checkTool('claude'),
      (window as any).electronAPI.checkTool('openclaw'),
    ]);

    return {
      nodejs: { name: 'Node.js', installed: nodejs.installed, version: nodejs.version, installing: false },
      claude: { name: 'Claude Code', installed: claude.installed, version: claude.version, installing: false },
      openclaw: { name: 'OpenClaw', installed: openclaw.installed, version: openclaw.version, installing: false },
    };
  }

  async installNodejs(): Promise<{ success: boolean; output?: string }> {
    return (window as any).electronAPI.installNodejs();
  }

  async installClaude(): Promise<{ success: boolean; output?: string }> {
    return (window as any).electronAPI.installClaude();
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
