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

  private get api(): any {
    return (window as any).electronAPI;
  }

  get isElectron(): boolean {
    return !!(window as any).electronAPI;
  }

  async checkAll(): Promise<AllToolsStatus> {
    if (!this.isElectron) {
      throw new Error('electronAPI not available');
    }
    const [nodejs, claude, openclaw] = await Promise.all([
      this.api.checkTool('node'),
      this.api.checkTool('claude'),
      this.api.checkTool('openclaw'),
    ]);

    return {
      nodejs: { name: 'Node.js', installed: nodejs.installed, version: nodejs.version, installing: false },
      claude: { name: 'Claude Code', installed: claude.installed, version: claude.version, installing: false },
      openclaw: { name: 'OpenClaw', installed: openclaw.installed, version: openclaw.version, installing: false },
    };
  }

  async installNodejs(): Promise<{ success: boolean; output?: string }> {
    if (!this.isElectron) { throw new Error('electronAPI not available'); }
    return this.api.installNodejs();
  }

  async installClaude(): Promise<{ success: boolean; output?: string }> {
    if (!this.isElectron) { throw new Error('electronAPI not available'); }
    return this.api.installClaude();
  }

  async installOpenclaw(): Promise<{ success: boolean; output?: string }> {
    if (!this.isElectron) { throw new Error('electronAPI not available'); }
    return this.api.installOpenclaw();
  }

  onInstallProgress(callback: (data: any) => void): void {
    if (!this.isElectron) { return; }
    this.api.onInstallProgress(callback);
  }

  removeInstallProgressListeners(): void {
    if (!this.isElectron) { return; }
    this.api.removeInstallProgressListeners();
  }
}
