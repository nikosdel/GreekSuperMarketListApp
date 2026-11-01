import { Routes } from '@angular/router';
import { signedIn } from './session';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./login-page').then((m) => m.LoginPage) },
  { path: 'register', loadComponent: () => import('./register-page').then((m) => m.RegisterPage) },
  {
    path: '',
    canActivate: [signedIn],
    loadComponent: () => import('./shell').then((m) => m.Shell),
    children: [
      { path: '', loadComponent: () => import('./lists-page').then((m) => m.ListsPage) },
      { path: 'history', loadComponent: () => import('./history-page').then((m) => m.HistoryPage) },
      { path: 'notices', loadComponent: () => import('./notices-page').then((m) => m.NoticesPage) },
      { path: 'lists/:id', loadComponent: () => import('./list-page').then((m) => m.ListPage) },
    ],
  },
];
