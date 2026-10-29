import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

export function privateAddress(value) {
  const ip = value.replace(/^::ffff:/, '');
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return ip === '::1' || (isIP(ip) === 6 && /^(fc|fd)/i.test(ip));
}
export function lanInterfaces() {
  return [...new Set(['127.0.0.1', ...Object.values(networkInterfaces()).flat().filter(Boolean).map((x) => x.address).filter((x) => isIP(x) === 4 && privateAddress(x))])];
}
export const defaultInterface = () => lanInterfaces().find((ip) => !ip.startsWith('127.')) ?? '127.0.0.1';
