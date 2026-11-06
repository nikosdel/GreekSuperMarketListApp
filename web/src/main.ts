import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js');
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
