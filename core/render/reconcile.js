// Bring project files in line with a new render (ADR-0003 "update flow per managed file").
// Used by `yaw init`, `yaw update` and `yaw remove`; it is the only code that writes module outputs.
//
// Inputs: the manifest's file entries, the desired outputs (path -> { module, content, fragments })
// and the options. Output: the new file entries, a report, and the list of files left with conflicts.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { basePath, hashContent, readProjectFile, removeFile, writeAtomic } from './files.js';

export const STRATEGIES = ['keep', 'take', 'merge'];

// Lines git merge-file writes around a conflict; doctor and status look for them.
export function hasConflictMarkers(content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  return /^<{7} /m.test(text) && /^>{7} /m.test(text);
}

// `diff -u` of two contents via git (a prerequisite, doc 01 §4).
export function unifiedDiff(path, current, next) {
  const dir = mkdtempSync(join(tmpdir(), 'yaw-diff-'));
  try {
    const a = join(dir, 'current', path);
    const b = join(dir, 'new', path);
    mkdirSync(dirname(a), { recursive: true });
    mkdirSync(dirname(b), { recursive: true });
    writeFileSync(a, current ?? '');
    writeFileSync(b, next ?? '');
    const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-prefix', '-U3', '--', `current/${path}`, `new/${path}`], {
      cwd: dir, encoding: 'utf8',
    });
    if (r.error) throw r.error;
    if (r.status > 1) throw new Error(`git diff failed: ${r.stderr.trim()}`);
    const lines = r.stdout.split('\n');
    const start = lines.findIndex((l) => l.startsWith('--- '));
    return start === -1 ? '' : lines.slice(start).join('\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Three-way merge via `git merge-file` (ADR-0003). -> { content: Buffer, conflicts: number }
export function mergeFile(current, base, next, { label = 'kit' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'yaw-merge-'));
  try {
    const files = ['current', 'base', 'new'].map((n) => join(dir, n));
    writeFileSync(files[0], current);
    writeFileSync(files[1], base);
    writeFileSync(files[2], next);
    const r = spawnSync('git', ['merge-file', '-p', '-L', 'yours', '-L', 'base', '-L', label, ...files], { maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw r.error;
    if (r.status === null || r.status > 127) throw new Error(`git merge-file failed: ${r.stderr.toString().trim()}`);
    return { content: r.stdout, conflicts: r.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function entryFor(path, d) {
  return { path, module: d.module, hash: hashContent(d.content), managed: true, fragments: d.fragments ?? [] };
}

// options:
//   mode         'init' | 'update' | 'remove'; removing: the module `yaw remove` takes out
//   strategy     'keep' | 'take' | 'merge' | undefined   (--strategy)
//   interactive  boolean; prompter: { ask(question) -> Promise<string>, show(text) }
//   restore, forget: Set of paths (yaw update --restore / --forget)
//   label        label for the kit side of conflict markers
export async function reconcile(root, entries, desired, options = {}) {
  const { mode = 'update', removing, strategy, interactive = false, prompter, label = 'kit' } = options;
  const restore = options.restore ?? new Set();
  const forget = options.forget ?? new Set();
  const old = new Map(entries.map((e) => [e.path, e]));
  const paths = [...new Set([...old.keys(), ...desired.keys()])].sort();
  const files = [];
  const report = [];
  const conflicts = [];
  const note = (path, action, extra = {}) => report.push({ path, action, ...extra });

  const writeWithBase = (path, content) => {
    writeAtomic(root, path, content);
    writeAtomic(root, basePath(path), content, { kitOwned: true });
  };
  const setBase = (path, content) => writeAtomic(root, basePath(path), content, { kitOwned: true });
  const dropBase = (path) => removeFile(root, basePath(path), { kitOwned: true });

  // Edited file, new render differs: keep / take / merge. canMerge is false without a base.
  const choose = async (path, current, next, canMerge) => {
    if (strategy) return strategy === 'merge' && !canMerge ? 'keep' : strategy;
    if (!interactive) return 'keep';
    prompter.show(`\n${path} was edited and the kit changed it:\n${unifiedDiff(path, current, next)}\n`);
    const options = canMerge ? '[k]eep / [t]ake / [m]erge' : '[k]eep / [t]ake';
    for (;;) {
      const a = (await prompter.ask(`${path}: ${options} (default keep)? `)).trim().toLowerCase();
      if (a === '' || a === 'k' || a === 'keep') return 'keep';
      if (a === 't' || a === 'take') {
        const sure = (await prompter.ask(`Overwrite ${path} with the kit version? [y/N] `)).trim().toLowerCase();
        return sure === 'y' || sure === 'yes' ? 'take' : 'keep';
      }
      if (canMerge && (a === 'm' || a === 'merge')) return 'merge';
    }
  };

  for (const path of paths) {
    const e = old.get(path);
    const d = desired.get(path);
    const current = readProjectFile(root, path);
    const removingThis = mode === 'remove' && e?.module === removing;

    // New output, not in the manifest yet.
    if (!e) {
      const next = d.content;
      if (current === null) {
        writeWithBase(path, next);
        files.push(entryFor(path, d));
        note(path, 'added');
      } else if (hashContent(current) === hashContent(next)) {
        setBase(path, next);
        files.push(entryFor(path, d));
        note(path, 'adopted');
      } else {
        // An existing file the kit did not write: "edited, template changed" without a base.
        const choice = await choose(path, current, next, false);
        if (choice === 'take') {
          writeWithBase(path, next);
          note(path, 'taken');
        } else {
          setBase(path, next);
          note(path, 'kept', { reason: 'existing file' });
        }
        files.push(entryFor(path, d));
      }
      continue;
    }

    // Owned by the user: never written.
    if (!e.managed) {
      if (!d) {
        if (removingThis) note(path, 'owned-kept');
        else files.push(e);
        continue;
      }
      const nextHash = hashContent(d.content);
      if (nextHash !== e.hash) {
        note(path, 'owned-changed', { diff: unifiedDiff(path, current ?? '', d.content) });
        files.push({ ...e, hash: nextHash });
      } else {
        files.push(e);
      }
      continue;
    }

    // Managed file that is gone from disk: not recreated (ADR-0003 "Deleted files").
    if (current === null) {
      if (forget.has(path)) {
        dropBase(path);
        note(path, 'forgotten');
      } else if (!d) {
        dropBase(path);
        note(path, 'dropped');
      } else if (restore.has(path)) {
        writeWithBase(path, d.content);
        files.push(entryFor(path, d));
        note(path, 'restored');
      } else {
        files.push(e);
        note(path, 'missing');
      }
      continue;
    }

    const edited = hashContent(current) !== e.hash;

    // Template removed (renamed, module removed).
    if (!d) {
      if (!edited) {
        removeFile(root, path);
        dropBase(path);
        note(path, 'deleted');
      } else if (removingThis) {
        let del = strategy === 'take';
        if (!strategy && interactive) {
          const a = (await prompter.ask(`${path} was edited. Delete it anyway? [y/N] `)).trim().toLowerCase();
          del = a === 'y' || a === 'yes';
        }
        dropBase(path);
        if (del) {
          removeFile(root, path);
          note(path, 'deleted', { reason: 'edited' });
        } else {
          note(path, 'released');
        }
      } else {
        dropBase(path);
        files.push({ ...e, managed: false, fragments: [] });
        note(path, 'released');
      }
      continue;
    }

    const next = d.content;
    const nextHash = hashContent(next);
    if (nextHash === e.hash) {
      files.push({ ...entryFor(path, d), hash: e.hash });
      if (edited) note(path, 'edited');
      continue;
    }
    if (!edited) {
      writeWithBase(path, next);
      files.push(entryFor(path, d));
      note(path, 'updated');
      continue;
    }
    if (hashContent(current) === nextHash) {
      setBase(path, next);
      files.push(entryFor(path, d));
      note(path, 'rebased');
      continue;
    }
    const base = readProjectFile(root, basePath(path), { kitOwned: true });
    const choice = await choose(path, current, next, base !== null);
    if (choice === 'take') {
      writeWithBase(path, next);
      note(path, 'taken');
    } else if (choice === 'merge') {
      const merged = mergeFile(current, base, next, { label });
      writeAtomic(root, path, merged.content);
      setBase(path, next);
      if (merged.conflicts > 0) {
        conflicts.push(path);
        note(path, 'conflict', { conflicts: merged.conflicts });
      } else {
        note(path, 'merged');
      }
    } else {
      setBase(path, next);
      note(path, 'kept', { reason: base === null && strategy === 'merge' ? 'no base, merge not possible' : 'edited' });
    }
    files.push(entryFor(path, d));
  }
  return { files, report, conflicts };
}
