import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'dist-electron/', 'ios/', 'android/', 'src-tauri/', '*.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
