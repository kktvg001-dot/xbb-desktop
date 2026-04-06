import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'setup', loadComponent: () => import('./pages/setup/setup.component').then(m => m.SetupComponent) },
  { path: 'chat', loadComponent: () => import('./pages/chat/chat.component').then(m => m.ChatComponent) },
  { path: 'status', loadComponent: () => import('./pages/status/status.component').then(m => m.StatusComponent) },
  { path: 'settings', loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent) },
  { path: '', redirectTo: 'chat', pathMatch: 'full' },
  { path: '**', redirectTo: 'chat' },
];
