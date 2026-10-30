import type { CapacitorConfig } from '@capacitor/cli';

// `npx cap add ios|android` and native builds need Xcode or the Android SDK; you run them.
const config: CapacitorConfig = {
  appId: 'com.example.app',
  appName: 'App',
  webDir: 'dist',
};

export default config;
