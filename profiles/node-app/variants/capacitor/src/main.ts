import { Capacitor } from '@capacitor/core';
import { greeting } from './greeting';

const target = document.querySelector('#greeting');
if (target) target.textContent = `${greeting(null)} (${Capacitor.getPlatform()})`;
