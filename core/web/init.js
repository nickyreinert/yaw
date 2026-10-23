import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFormModel, assertSafe, FormError } from './form-model.js';
import { startFormServer } from './form-server.js';
import { initProject } from '../render/project.js';
import { readManifest } from '../render/manifest.js';
import { writeAtomic } from '../render/files.js';
import { kitVersion } from '../render/kit.js';
import { saveSetup } from '../lib/user-store.js';
import { validateSecretValues, writeEnvSecrets } from '../lib/env-secrets.js';
import { printReport } from '../cli/commands.js';

export const DRAFT = '.yaw/draft.yaml';

export function createFormApi({ root, kitRoot, env, verify, skipVerify = false, stderr }) {
  const model = createFormModel({ root, kitRoot, env });
  const ensureNew = () => {
    if (readManifest(root)) throw new FormError('This project is already initialized; use yaw update', 409);
  };
  return {
    bootstrap: () => ({ ...model.bootstrap(), skipVerify }),
    prepareApply(input) {
      ensureNew();
      if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new FormError('Expected a setup object');
      const { secrets, ...setup } = input;
      const prepared = model.normalize(setup);
      try {
        prepared.secretValues = validateSecretValues(secrets, model.secretCatalog(prepared).names);
      } catch (e) {
        throw new FormError(e.message);
      }
      return prepared;
    },
    async action(name, input) {
      if (name === 'prefill') {
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).some((k) => !['kind', 'name'].includes(k))) throw new FormError('Invalid prefill request');
        return model.prefill(input.kind, input.name);
      }
      if (name === 'preview' || name === 'diff') return model.preview(input, name === 'diff');
      ensureNew();
      const prepared = model.normalize(input);
      if (name === 'draft') {
        writeAtomic(root, DRAFT, prepared.text, { mode: 0o600 });
        return { message: `Draft saved to ${DRAFT}; no generated files were applied.` };
      }
      if (name === 'preset') {
        if (input.consent !== true || (input.saveProfile !== undefined && typeof input.saveProfile !== 'boolean')) {
          throw new FormError('Saving requires explicit consent for this save; nothing was stored');
        }
        let saved;
        try {
          saved = saveSetup({
            env, kitRoot, answers: prepared.doc.answers, mode: prepared.doc.mode,
            projectRoot: root, kit: kitVersion(kitRoot), preset: true, profile: input.saveProfile === true,
          });
        } catch (e) {
          if (e.message.startsWith('not saved,') || e.message.includes('cannot be read; fix or remove the file')) {
            throw new FormError('Existing user preferences are unreadable or invalid; nothing was saved. Fix the user-profile.yaml file first.');
          }
          throw e;
        }
        if (!saved.saved) throw new FormError('An answer looks like a secret; nothing was stored');
        return { message: `Saved preset ${saved.preset}${saved.profile ? ' and user profile' : ''}. Consent is not remembered.` };
      }
      throw new FormError('Unknown action', 404);
    },
    async apply(prepared, emit) {
      ensureNew();
      assertSafe(prepared.doc.answers, kitRoot);
      const output = { write: (text) => emit({ type: 'log', text: String(text) }) };
      emit({ type: 'log', text: 'Applying confirmed setup…\n' });
      const result = await initProject({ root, kitRoot, answers: { text: prepared.text, doc: prepared.doc }, modules: prepared.modules });
      printReport(output, result);
      emit({ type: 'log', text: 'Wrote .yaw/answers.yaml and .yaw/manifest.json\n' });
      const saved = writeEnvSecrets(root, model.secretCatalog(prepared).names, prepared.secretValues);
      if (saved.preserved) emit({ type: 'log', text: 'Existing .env was preserved; submitted secret values were not saved.\n' });
      else if (saved.written) emit({ type: 'log', text: `Saved ${saved.written} secret value(s) to .env (mode 0600).\n` });
      let ok = true;
      let message;
      if (skipVerify) {
        emit({ type: 'log', text: 'Verification explicitly skipped (--skip-verify); run: just setup && just check\n' });
        message = 'Applied; verification skipped.';
      } else if (saved.written) {
        emit({ type: 'log', text: 'Verification skipped because new secrets were saved; review the project recipes before running: just setup && just check\n' });
        message = 'Applied with secrets; verification skipped. Review the project recipes before running just setup and just check.';
      } else {
        ok = await verify({ root, io: { env, stdout: output, stderr: output } });
        message = ok ? 'Applied and verified.' : 'Files applied, but verification failed. Fix the reported problem and run just setup && just check.';
      }
      emit({ type: 'done', ok, message });
    },
    failed(error) {
      // The browser gets no untrusted exception text (which could contain answer values).
      stderr?.write(`yaw init --web: ${error.name ?? 'Error'}${error.code ? ` (${error.code})` : ''}; operation failed\n`);
    },
  };
}

// The start token must never appear in argv (other local users can read process arguments): the browser opens a
// private launcher file (0600 in a 0700 folder) that redirects to the tokenized URL. The file is removed on close.
export function writeLauncher(url) {
  const dir = mkdtempSync(join(tmpdir(), 'yaw-web-'));
  const file = join(dir, 'open.html');
  const safe = url.replace(/[^A-Za-z0-9:/?=.]/g, '');
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${safe}"><title>YAW setup</title>\n`, { mode: 0o600 });
  return { file, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

function openBrowser(target, env) {
  const [command, args] = process.platform === 'darwin' ? ['open', [target]] :
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', target]] : ['xdg-open', [target]];
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

export async function initWeb({ io, skipVerify, verify }) {
  const api = createFormApi({ root: io.cwd, kitRoot: io.kitRoot, env: io.env, verify, skipVerify, stderr: io.stderr });
  let finish;
  const done = new Promise((r) => { finish = r; });
  let exitCode = 1;
  const apply = api.apply;
  api.apply = async (...args) => {
    const emit = args[1];
    args[1] = (event) => {
      if (event.type === 'done') exitCode = event.ok ? 0 : 1;
      emit(event);
    };
    return apply(...args);
  };
  let launcher;
  const server = await startFormServer({ api, onClose: () => { launcher?.remove(); finish(exitCode); } });
  io.stdout.write(`YAW setup (local only). Open this one-time link:\n${server.url}\nNothing is written until Save draft, Save as preset, or Apply. Ctrl+C stops the server.\n`);
  let opened;
  if (io.openBrowser) opened = await io.openBrowser(server.url, io.env);
  else {
    launcher = writeLauncher(server.url);
    opened = await openBrowser(launcher.file, io.env);
  }
  if (!opened) io.stdout.write('Browser could not be opened automatically; open the link above manually.\n');
  return done;
}
