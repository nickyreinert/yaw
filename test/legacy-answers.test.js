// T-002: the language id javascript was renamed to typescript; old answers stay readable.
import assert from 'node:assert/strict';
import test from 'node:test';
import { currentValue, migrateAnswers } from '../core/interview/legacy.js';
import { stackProfile } from '../core/interview/suggest.js';
import { parseKickoffReply } from '../core/lib/kickoff.js';
import { listProfiles } from '../core/render/kit.js';
import { parseAnswers } from '../core/render/project.js';
import { KIT_ROOT } from './helpers/fixtures.js';

test('migrateAnswers renames javascript to typescript and leaves everything else alone', () => {
  const before = { 'arch.language': 'javascript', 'arch.runs-on': 'local', 'idea.text': 'javascript tool' };
  const after = migrateAnswers(before);
  assert.deepEqual(after, { 'arch.language': 'typescript', 'arch.runs-on': 'local', 'idea.text': 'javascript tool' });
  assert.equal(before['arch.language'], 'javascript', 'the input is not changed');
  assert.deepEqual(migrateAnswers({ 'arch.language': 'python' }), { 'arch.language': 'python' });
  assert.deepEqual(migrateAnswers({}), {});
  assert.equal(currentValue('arch.language', 'javascript'), 'typescript');
  assert.equal(currentValue('idea.text', 'javascript'), 'javascript');
});

test('an answers file that says javascript loads as typescript and still picks its profile', () => {
  const text = 'mode: quick\nanswers:\n  user.agents: [claude]\n  idea.text: A tool.\n  arch.language: javascript\n  arch.runs-on: local\n';
  const doc = parseAnswers(text);
  assert.equal(doc.answers['arch.language'], 'typescript');
  assert.equal(stackProfile(listProfiles(KIT_ROOT), doc.answers).profile, 'node-cli');
});

test('a plan reply that says javascript is read as typescript', () => {
  const languages = [{ value: 'python', label: 'Python' }, { value: 'typescript', label: 'TypeScript' }];
  const hosts = [{ value: 'local', label: 'your computer' }];
  const reply = '## Idea\nA tool.\n\n## Stack\nlanguage: javascript\nruns-on: local\n';
  assert.equal(parseKickoffReply(reply, { languages, hosts }).language, 'typescript');
});
