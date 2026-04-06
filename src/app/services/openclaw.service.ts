import { Injectable } from '@angular/core';

export interface OpenclawStatus {
  gateway: boolean;
  whatsapp: 'connected' | 'disconnected' | 'unknown';
  raw: string;
}

@Injectable({ providedIn: 'root' })
export class OpenclawService {

  async getStatus(): Promise<OpenclawStatus> {
    return window.electronAPI.getOpenclawStatus();
  }

  async restart(): Promise<{ success: boolean; error?: string }> {
    return window.electronAPI.restartOpenclaw();
  }
}
