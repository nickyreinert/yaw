// Checks every local href/src/anchor in public/**/*.html. No network, no dependencies.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const root = realpathSync(resolve('public'));
const problems = [];
// Walk without following symlinks: a symlink (file or directory) is reported and never read.
const pages = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) problems.push(`${full.slice(root.length + 1)}: symlinks in public/ are not followed`);
    else if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) pages.push(full);
  }
};
walk(root);
const safeDecode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
const ids = (file) => new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

for (const page of pages) {
  const name = page.slice(root.length + 1);
  const realPage = realpathSync(page);
  if (!realPage.startsWith(root + sep)) {
    problems.push(`${name}: page is outside public/`);
    continue;
  }
  const html = readFileSync(page, 'utf8');
  for (const [, , ref] of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref) || ref === '') continue;
    const [beforeHash, hash = ''] = ref.split('#');
    const path = safeDecode(beforeHash.split('?')[0]);
    let target = path === '' ? page : resolve(path.startsWith('/') ? root : dirname(page), path.replace(/^\//, ''));
    if (!existsSync(target)) {
      problems.push(`${name}: broken link "${ref}"`);
      continue;
    }
    if (statSync(target).isDirectory()) target = join(target, 'index.html');
    if (!existsSync(target)) {
      problems.push(`${name}: broken link "${ref}"`);
      continue;
    }
    const real = realpathSync(target);
    if (real !== root && !real.startsWith(root + sep)) {
      problems.push(`${name}: link "${ref}" points outside public/`);
      continue;
    }
    if (hash && real.endsWith('.html') && !ids(real).has(safeDecode(hash))) problems.push(`${name}: missing anchor "${ref}"`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check-links: ${pages.length} page(s), all local links resolve`);
