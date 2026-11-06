import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'gr.supermarket.list',
  appName: 'Super Market List',
  webDir: 'dist/web/browser',
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
};

export default config;
