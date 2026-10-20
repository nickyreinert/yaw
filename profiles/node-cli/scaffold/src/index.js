import { pathToFileURL } from 'node:url';

export function greet(name) {
  return `Hello, ${name}!`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(greet(process.argv[2] ?? 'world'));
}
