import { isTauri } from '@tauri-apps/api/core';
import { greeting } from './greeting';

// The Rust shell (src-tauri/) comes from `npx tauri init` and needs Rust; native builds are yours.
const target = document.querySelector('#greeting');
if (target) target.textContent = `${greeting(null)} (${isTauri() ? 'tauri' : 'browser'})`;
