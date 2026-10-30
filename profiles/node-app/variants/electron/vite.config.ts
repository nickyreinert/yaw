import { defineConfig } from 'vite';

// Relative asset paths: Electron loads dist/index.html from disk.
export default defineConfig({ base: './' });
