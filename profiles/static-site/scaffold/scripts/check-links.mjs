// Checks every local href/src/anchor in public/**/*.html. No network, no dependencies.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve('public');
const pages = readdirSync(root, { recursive: true }).filter((f) => f.endsWith('.html')).map((f) => join(root, f));
const ids = (file) => new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const problems = [];

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const [, , ref] of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref) || ref === '') continue;
    const [path, hash] = ref.split('#');
    let target = path === '' ? page : resolve(path.startsWith('/') ? root : dirname(page), path.replace(/^\//, ''));
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
    if (!existsSync(target)) problems.push(`${page.slice(root.length + 1)}: broken link "${ref}"`);
    else if (hash && target.endsWith('.html') && !ids(target).has(hash)) problems.push(`${page.slice(root.length + 1)}: missing anchor "${ref}"`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check-links: ${pages.length} page(s), all local links resolve`);
